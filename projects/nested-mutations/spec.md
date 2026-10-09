# nested-mutations

## Purpose

Let a caller change the rows related to a record in the same `update()` call that changes the record, for the cases Prisma 7 users rely on and Prisma 8 cannot express today: updating or deleting a filtered set of related rows, updating a related row or creating it when it is absent, and creating a related row or linking the one that already exists. The Prisma 7 tests that could not be ported because these operations were missing are ported as part of the project, so the behaviour is checked against Prisma 7's own suites. A nested write must never change a row that is not related to the record being updated, except to link it when the caller asks for a link.

## At a glance

Today a relation callback inside `update()` data returns exactly one of `create`, `connect` or `disconnect`. After this project it can also return `upsert`, a filtered `updateAll` or `deleteAll`, or an array of several operations applied in order. Nested `create` also takes an `onConflict` option: `'skip'`, which top-level `createAll` already has, and `'connect'`, which links the existing row and takes the place of Prisma 7's `connectOrCreate`.

Illustrative (re-verify names against shipped code before relying on them):

```ts
await db.User.where({ id: 1 }).update({
  name: 'Alice',
  posts: (p) => [
    p.create([{ slug: 'new', title: 'New' }], { onConflict: 'skip' }),
    p.create({ slug: 'shared', title: 'Shared' }, { onConflict: 'connect', conflictOn: ['slug'] }),
    p.where({ published: false }).updateAll({ published: true }),
    p.where((post) => post.title.like('Draft%')).deleteAll(),
    p.upsert({
      create: { slug: 'hello', title: 'Hello' },
      update: { title: 'Hello' },
    }),
  ],
});
```

| Operation | Shape | Relations | Rows it can change |
| --- | --- | --- | --- |
| `updateAll` | `r.where(w).updateAll(data)`; `where` optional | to-many | rows related to the parent that match the filter |
| `deleteAll` | `r.where(w).deleteAll()`; `where` optional | to-many | rows related to the parent that match the filter |
| `upsert` | `r.upsert({ create, update, conflictOn? })` | to-one and to-many | one row related to the parent, or a newly created row |
| `create` with skip | `r.create(rows, { onConflict: 'skip', conflictOn? })` | 1:N only | none that exist; a row that collides with a unique constraint is not inserted |
| `create` with connect | `r.create(rows, { onConflict: 'connect', conflictOn? })` | any | a row that collides is linked to the parent; its other fields are not changed |
| array | `(r) => [op, op, …]` | any | each operation in array order |

**The scoping rule.** `updateAll`, `deleteAll` and `upsert` act only on rows already related to the parent. What "related" means depends on which side stores the link:

| Link stored on | Related means |
| --- | --- |
| Parent (to-one) | the row the parent's foreign key points to |
| Child (1:N, 1:1) | the child's foreign key equals the parent's key |
| Junction table (M:N) | a junction row joins the parent and the target |

**Upsert matching.** On a to-one relation the row to update is the linked row; there are no conflict columns and `conflictOn` is absent from the signature. If no row is linked, the `create` branch runs and the new row is linked. On a to-many relation the row is found by conflict columns, as in top-level `upsert`, and updated only if it is related to the parent. If a row with the same unique value exists but is not related to the parent, nothing is written and the ORM throws `ORM.NESTED_UPSERT_CONFLICT`, a new error code whose `meta` carries the relation name and the conflict columns. In the `create` branch the new row is linked to the parent.

**Create with skip.** The options argument is the one top-level `createAll` takes. A row that collides with a unique constraint is skipped: nothing is written for it, the existing row is left as it is and is not linked to the parent, and relation callbacks inside the skipped row's data do not run. Without the option a collision fails the whole call, as today. It is available on one-to-many relations only, which is where Prisma 7 offers nested `createMany` with `skipDuplicates`: on the other layouts a skipped row returns no key to link with.

**Create with connect.** A row that collides on the conflict columns is not inserted; the existing row is linked to the parent instead, and its other fields keep their values. A row that does not collide is inserted and linked. The conflict columns come from `conflictOn`, or default to the primary key as in top-level `upsert`. It is available on every relation layout. On one-to-many, linking sets the existing child's foreign key, so a child that belonged to another parent moves to this one, as plain `connect` already does. Compared with Prisma 7's `connectOrCreate`, the row to look for is given by the conflict columns' values in the row itself, not by a separate `where`.

Both options are available in `create()` and `update()`. `'connect'` is valid in nested `create` only; top-level `createAll` keeps accepting `'skip'` alone.

**One statement per row for connect.** The insert carries a conflict clause that updates on conflict, so the database returns the row whether it was inserted or already existed. On one-to-many the update sets the foreign key, which is the link itself. On the other layouts it assigns a conflict column its own proposed value and the link is written afterwards: the junction row on many-to-many, the parent's foreign key on to-one.

**Why arrays.** Prisma 7 accepts several operations on one relation in one call, and the upstream tests depend on it. With an array the caller states the order; operations on one relation run in array order.

## How it is built: the mutation graph

Every write method of the collection (`create`, `createAll`, `createAndCount`, `update`, `updateAll`, `updateAndCount`, `delete`, `deleteAll`, `deleteAndCount`, `upsert`) builds a **mutation graph** and hands it to one runner. The nested-write executor and the branch in `create()` and `update()` on "does the input contain a relation callback" are removed. The design, the reason for each decision and the rejected alternatives are in [`mutation-graph.md`](./mutation-graph.md); the rules below are the ones every slice works against.

- **Nodes are database-level steps.** `Find`, `Insert`, `Update`, `Delete`, `Assert`, `Merge`, and `State(table, n)` for a version of a table. Each is a frozen class.
- **Edges carry everything one node takes from another, and every edge implies order.** `After` is order only; `PayloadData` copies columns into a write's values; `FilterData` adds `target = value`, or `IN` for many rows. A data edge holds a list of column pairs, so a composite key is one edge. A node holds its statement as SQL AST (`SelectAst`, `InsertAst`, `UpdateAst`, `DeleteAst`) and nothing else that describes it.
- **One translation turns a user operation on a relation layout into nodes and edges.** The runner and the nodes know nothing about relations.
- **Order comes only from edges.** A read depends on the latest state of its table; a write depends on it and on the reads of it, and produces the next state. An update or delete on the target table of a relation with a `through` also advances the junction table's state.
- **Edges resolve data, nodes execute.** An edge turns one row of its source into a condition or a record of values; a node receives those per input slot and runs its own statement. A node whose data source had no rows returns no rows without running; an `Assert` node is the only way an empty result becomes an error.
- **Optimisation is by `peephole()` on a node class, called when the node is added.** No passes. The rule that many-to-many `updateAll` and `deleteAll` depend on: a junction `Find` with no other user is inlined into its consumer as `column IN (SELECT ...)`.
- **Adding a data edge makes its source return the columns the edge reads;** the builder sets the caller's selection on the result node. The parent's write returns the caller's `select`; `include` is loaded afterwards by the existing read code in the same transaction.
- **The runner** executes nodes one at a time in dependency order, collects a node that another node reads from, lets only the result node stream, and opens a transaction when the graph will execute more than one statement.

The work is delivered in two stages. Stage 1 moves what main does today onto the graph, with no new behaviour. Stage 2 adds this project's operations one at a time as entries in the translation. PR #30634, which added `updateAll`, `deleteAll` and array returns to the executor, is closed without merging; its mutator types, integration tests, docs and the ports in PR #30642 are reused in stage 2.

## Upstream tests in scope

The project ports every upstream test, in both pinned suites (`prisma/prisma` and `prisma/prisma-engines`), that is unported, ported-and-failing or recorded as non-portable **because of a nested operation this project adds**. Each is written against the Prisma 8 form:

| Prisma 7 nested operation | Ported as |
| --- | --- |
| `updateMany` | `r.where(w).updateAll(data)` |
| `deleteMany` | `r.where(w).deleteAll()` |
| `upsert` | `r.upsert({ create, update, conflictOn? })` |
| `createMany` with `skipDuplicates` | `r.create(rows, { onConflict: 'skip' })` |
| `connectOrCreate` | `r.create(row, { onConflict: 'connect', conflictOn })`, with the `where` value written into the row |
| several operations on one relation | an array returned from the relation callback |

A test that also needs something this project does not deliver stays unported, and its ledger entry is rewritten to name only what is still missing. That covers tests that need nested `set`, nested single-row `update` or `delete`, nested writes inside top-level `upsert`, composite-field operations, or the Mongo ORM. A ported test whose Prisma 8 result differs from Prisma 7's is kept as a failing port with a ledger entry, per the corpus rules; the known cases are the `ORM.NESTED_UPSERT_CONFLICT` error where Prisma 7 raises P2002, and a `connectOrCreate` whose `create` data contradicts its `where`.

### Engine tests

Most of the in-scope tests are engine tests that nobody has tried to port yet: they are unchecked in `projects/port-all-tests/checklists/` and have no ledger entry. Only two ledger entries exist today for an operation this project adds (`filter_unwrap` › `many_filter` and `nested_create_many` › `no_error_on_dups_when_skip_dups`).

The list below comes from the upstream sources, not from checklist descriptions: every test function under `query-engine/connector-test-kit-rs/query-engine-tests/tests/` at the pinned commit was searched for a nested `updateMany`, `deleteMany`, `upsert`, `createMany`, `skipDuplicates` or `connectOrCreate`. "Tests" counts the test functions in the file that use one.

| Upstream file (under `tests/`) | Tests | Operations used |
| --- | --- | --- |
| `writes/nested_mutations/already_converted/nested_update_many_inside_update.rs` | 8 | `updateMany` |
| `writes/nested_mutations/already_converted/nested_delete_many_inside_update.rs` | 6 | `deleteMany` |
| `writes/nested_mutations/already_converted/nested_upsert_inside_update.rs` | 5 | `upsert` |
| `writes/nested_mutations/not_using_schema_base/nested_connect_or_create.rs` | 6 | `connectOrCreate` |
| `writes/nested_mutations/not_using_schema_base/nested_create_many.rs` | 5 | `createMany`; 2 with `skipDuplicates` |
| `writes/nested_mutations/combining_different_nested_mutations.rs` | 2 | `create_then_upsert`, `create_then_disconnect` |
| `writes/unchecked_writes/unchecked_nested_update_many.rs` | 4 | `updateMany` |
| `writes/ids/relation_pks/compound_pk_rel_field.rs` | 4 | `upsert`; 2 also `updateMany`, `deleteMany` |
| `writes/ids/relation_pks/single_pk_rel_field.rs` | 4 | `upsert`; 2 also `updateMany`, `deleteMany` |
| `writes/uniques_and_node_selectors/relation_uniques/compound_uniq_rel_field.rs` | 4 | `upsert`; 2 also `updateMany`, `deleteMany` |
| `queries/order_and_pagination/nested_pagination.rs` | 3 | `connectOrCreate`, used to build the data |
| `writes/regressions/prisma_11731.rs` | 2 | `connectOrCreate` on 1:1 |
| `writes/ids/byoid.rs` | 2 | `upsert` |
| `writes/regressions/if_node_siblig_dep_regression.rs` | 1 | `connect` with `connectOrCreate` |
| `writes/top_level_mutations/delete_many.rs` | 1 | `deleteMany` |
| `writes/uniques_and_node_selectors/multi_field_uniq_mutation.rs` | 1 | `upsert` |
| `writes/data_types/datetime/non_embed_updated_at_should_change.rs` | 1 | `upsert` |
| `new/ref_actions/on_update/set_null.rs` | 1 | `upsert` |
| `new/regressions/prisma_8265.rs` | 1 | `updateMany` |
| `new/regressions/prisma_27452.rs` | 1 | `createMany` |
| `sharding/relations.rs` | 1 | `upsert` |
| `queries/filters/filter_unwrap.rs` | 1 | `deleteMany`; recorded non-portable today |

That is 64 test functions in 22 files. Some of them also use an operation this project does not deliver, for example the nested single-row `delete` in the three relation-key files, and stay unported under the rule above; which ones is settled test by test in the slice that ports the file.

Found by the same search and out by the rule above: `writes/composites/**` (composite-field operations), `writes/ids/byoid_mongo.rs` (Mongo), `writes/top_level_mutations/non_embedded_upsert.rs` (nested writes inside top-level `upsert`), and the top-level `skipDuplicates` tests in `create_many.rs` and `create_many_and_return.rs`, which are already ported. Not matched by the search, and out: `nested_delete_inside_upsert.rs`, `nested_disconnect_inside_upsert.rs`, `nested_connect_inside_upsert.rs`, `nested_set_inside_update.rs`, `nested_update_inside_update.rs`, `nested_delete_inside_update.rs`, `nested_atomic_number_ops.rs`.

### Client tests

The pinned `prisma/prisma` functional suite uses these operations in very few tests. None uses `connectOrCreate`. The two that use nested `upsert` or `updateMany` and are not ported each need something else as well, so they stay unported with a rewritten ledger entry: `optimistic-concurrency-control` › `update with upsert relation` (needs `increment`) and `blog-update` (needs single-row `update`). The suites that use nested `createMany` are already ported with array `create`.

## Non-goals

- Nested `set`.
- A nested operation named `connectOrCreate`, and its separate `where` argument. `create` with `onConflict: 'connect'` covers the need.
- Nested single-row `update` and `delete`. They will get their own design.
- Nested writes inside top-level `upsert`, whose `create` and `update` inputs stay scalar-only.
- Any option on nested `create` other than `onConflict` and `conflictOn`.
- `onConflict: 'connect'` on top-level `createAll`.
- Relation writes inside nested `upsert` data: its `create` and `update` take scalar fields only, as at top level.
- Handling referential actions in the ORM. A many-to-many `deleteAll` deletes the target rows and nothing else; what happens to junction rows is decided by the schema's foreign-key action.
- Reporting which other parent owns a conflicting row.
- The Mongo ORM. It has no nested writes today: no relation callbacks in write data, not even `create`, `connect` or `disconnect`. Adding them means designing the surface for reference and embed relations and atomicity across collections, which is a separate project. Nothing in this project changes `packages/2-mongo-family/**`.
- Reads in the mutation graph. `include` and every read method keep their current code.
- Optimisation passes, a worklist, and any peephole rule beyond the ones a slice needs.
- Implicit many-to-many relations with no junction model. The graph works from a relation's `through`, so it does not prevent them, but nothing here adds them.
- Keeping the SQL statements main issues today. Stage 1 may change which statements a write issues and how many.

## Place in the larger world

- **`@internal/sql-orm-client`** (`packages/3-extensions/sql-orm-client`) owns the whole user-facing change: the relation mutator and its types, and the mutation graph that turns every write, nested or not, into statements. `mutation-executor.ts` is removed, and the write methods in `collection.ts` build graphs.
- **Top-level collection API.** The nested operations take their names, argument shapes and filter forms from the collection's `where`, `updateAll`, `deleteAll`, `upsert` and `createAll` (`CreateConflictOptions`). Two deliberate differences: nested `updateAll`/`deleteAll` do not require a `where`, because the parent already limits the rows, and nested `upsert` is limited to rows related to the parent.
- **TypeScript contract authoring** (`packages/2-sql/2-authoring/contract-ts`) gains the uniqueness rule for `hasOne` described under Contract impact.
- **Contract validation** (`packages/2-sql/1-core/contract`) rejects a relation whose link-column lists are empty, so the ORM can build a scoping condition from them without checking.
- **SQL AST** (`packages/2-sql/4-lanes/relational-core`). The conflict action of an insert needs a condition, so that an update on conflict can be limited to rows related to the parent.
- **Prisma 7 behaviour** is the reference for semantics, through the pinned upstream suites tracked in `projects/port-all-tests/`. Known departures: Prisma 8 names (`updateAll`, `deleteAll`), caller-chosen order through arrays, and an ORM error in place of the database's unique violation for a nested upsert that conflicts with an unrelated row.
- **`port-all-tests`** is a sibling project that owns the port corpus, its checklists and its ledgers. This project writes ports into that corpus and updates those checklists and ledgers for the tests listed under Upstream tests in scope; it follows that project's bucket rules and layout. It makes some of its unchecked upstream tests portable and changes the disposition of some of its ledger entries.

### Contract impact

No contract entity, kind or emitted artifact changes for a contract that is valid after this project. One authoring rule is added: TypeScript authoring rejects a `hasOne` relation whose `by` fields are not covered by a unique constraint on the child model, as PSL authoring already does with `PSL_NON_UNIQUE_BACKRELATION`. A to-one upsert on that layout uses the child's foreign key as its conflict target and depends on the constraint.

This is a breaking change for TypeScript-authored contracts that declare such a relation: they stop emitting until the foreign key is made unique or the relation is changed to `hasMany`. Three fixtures in this repo are in that state today (`test/e2e/framework/test/sqlite/fixtures/contract.ts`, `test/integration/test/sql-builder/fixtures/contract.ts`, `contract-no-pgvector.ts`) and are fixed by the slice that adds the rule. The change is announced in the upgrade instructions for app authors.

### Adapter impact

Postgres and SQLite adapters: both render the insert conflict clause and must render its new condition. Both must render `IN` over a subquery, which the SQL AST expresses for one column today; the row-value form for composite keys is added by slice `filtered-many-writes`. The Mongo adapter and the Mongo ORM are not affected.

## Cross-cutting requirements

- **Scoping.** No nested operation delivered by this project changes or deletes a row that is not related to the parent. A skipped `create` row changes nothing. Every slice that adds an operation shows this with a test in which an unrelated row matches the filter or the conflict columns and is left unchanged.
- **One write path.** After stage 1 there is one implementation of each write: no write method executes a statement except through the graph runner, and nothing branches on whether the input contains a relation callback.
- **Graph tests.** Each translation entry and each peephole rule has a unit test that asserts the graph it produces in a printed text form. Behaviour is asserted by integration tests on Postgres and SQLite, not by statement-level unit tests.
- **Atomicity.** A nested update that fails at any operation leaves no partial changes, as nested writes behave today.
- **`create()` context.** Array returns and `create` with either `onConflict` value are accepted in `create()`. `where`, `updateAll`, `deleteAll` and `upsert` are rejected there, by the types and at runtime, the way `disconnect` is rejected today.
- **Relation kinds.** `updateAll` and `deleteAll` on a to-one relation are rejected by the types and at runtime. So is `onConflict: 'skip'` on to-one and many-to-many `create`. Both `onConflict` values are refused on multi-table-inheritance variants, as top-level `createAll` refuses the option.
- **Vocabulary.** Nested operations use the collection's names. No Prisma 7 alias (`updateMany`, `deleteMany`) is added.
- **Both SQL targets.** Each operation behaves the same on Postgres and SQLite; no branching on target in the ORM. Upstream tests are ported for the SQL targets only; their MongoDB connector variants stay unaddressed by this project.
- **Docs.** The package README and the user-facing query docs describe each operation in the slice that ships it. They state the scoping rule and the array-order rule; no ADR is written, because the project changes one package's API behaviour and internals and no layer, boundary or shared pattern.

## Transitional-shape constraints

- Stage 1 changes no behaviour a caller can observe through results: every integration test on main passes unedited on Postgres and SQLite after each stage 1 slice. SQL statements may change; unit tests that assert statements or statement counts are rewritten. The three exceptions, all in slice `graph-nested`: junction `connect` takes its decided behaviour; invalid nested input is rejected even when the filter matches no row; a relation field that is not a callback is rejected with `ORM.RELATION_MUTATION_INVALID`.
- After each stage 1 slice, a write method is either wholly on the graph or wholly on main's code. The executor is removed in the slice that moves the last method that uses it.
- No stage 2 slice starts before stage 1 is merged, except `has-one-unique`, which does not touch the ORM client.
- Existing relation callbacks that return a single `create`, `connect` or `disconnect` keep working unchanged after every slice.
- The `hasOne` uniqueness rule merges before, or together with, the to-one `upsert` that depends on it.
- Each slice ships complete operations: an operation exposed by the types is implemented for every relation layout it is valid on, or is not exposed yet.
- The port ledgers stay consistent with behaviour after every slice: a test that becomes portable is ported or left unchecked, never left recorded as non-portable for a reason that no longer holds.

## Project Definition of Done

- [ ] Team-DoD floor items (inherited; see [`drive/calibration/dod.md`](../../drive/calibration/dod.md)).
- [ ] All ten write methods of the collection run through the mutation graph; `mutation-executor.ts` and the branch on relation callbacks in `create()` and `update()` no longer exist.
- [ ] Every integration test that was on main before stage 1 passes on Postgres and SQLite, unedited except for the three decided behaviour changes of slice `graph-nested`.
- [ ] A nested many-to-many `updateAll` or `deleteAll` issues one statement on the target table with the junction condition as `IN (SELECT ...)`, shown by a graph test.
- [ ] `updateAll`, `deleteAll` and `upsert` are callable inside `update()` relation callbacks, with and without `where` for the first two, on every relation layout each is valid on.
- [ ] Nested `create` accepts `{ onConflict: 'skip', conflictOn? }` on one-to-many relations in `create()` and `update()`.
- [ ] Nested `create` accepts `{ onConflict: 'connect', conflictOn? }` on every relation layout in `create()` and `update()`.
- [ ] TypeScript authoring rejects a `hasOne` over a foreign key with no unique constraint, with an error that names the relation and the fields; the in-repo fixtures that declared one are fixed; the upgrade instructions describe the change.
- [ ] A relation callback may return an array, in both `create()` and `update()`, and operations run in array order.
- [ ] For each of the three operations, an integration test on Postgres and on SQLite shows an unrelated row that matches the filter or conflict columns is left unchanged.
- [ ] A nested to-many upsert that conflicts with an unrelated row throws `ORM.NESTED_UPSERT_CONFLICT`, documented in the error reference.
- [ ] Each of the 64 engine test functions listed under Upstream tests in scope has a disposition recorded in the `port-all-tests` checklists.
- [ ] Every listed test that needs nothing outside this project is ported and passing, or ported and failing with a ledger entry that states the Prisma 8 difference. None is left unported or recorded as non-portable for lack of an operation this project delivers.
- [ ] Every test that stays unported because it also needs something outside this project has a ledger entry naming only what is still missing, and the checklists in `projects/port-all-tests/checklists/` match.

## Open Questions

None open. The questions raised by the 2026-10-09 discussion and their decisions, kept until each is reflected in a slice spec:

1. **Row-value `IN` for composite keys.** Decided: the column-list form of `IN` is added to the SQL AST and both adapters in the slice that adds many-to-many `updateAll` / `deleteAll`. One statement form for every key shape; no `EXISTS` variant.
2. **Junction `connect` in stage 1.** Decided: slice `graph-nested` takes the already-decided behaviour: a conflict clause where the junction has a key over exactly its link columns, a plain insert otherwise, no duplicate check, no wrapped error; `ORM.RELATION_LINK_DUPLICATE` is removed. It is the one deliberate behaviour change in stage 1. No test on main asserts either of main's errors.
3. **Rejection timing in stage 1.** Decided: the graph rejects invalid nested input while it is built, before any statement, including when the filter matches no row, where main resolves `null`. This matches Prisma 7 and is the second deliberate behaviour change in stage 1. An integration test on main that asserts the `null` result, if one exists, is edited in slice `graph-nested`; that has not been checked yet.
4. **`createAll` batching.** Decided: an `Insert` node is exactly one statement and holds one or many rows. The translation decides the batching: rows that can go into one statement become one node; rows that cannot (different column sets without the `defaultInInsert` capability, own-table variants, a row with nested operations of its own) become several nodes. The node never splits itself into statements, and no peephole merges inserts. How the rows of several `Insert` nodes are combined into the call's result, in input order, is settled in the design of slice `graph-creates`.
5. **Annotations.** Decided: the runner takes the caller's annotations and puts them on every statement the call executes, including lookups, child writes and junction inserts. A middleware sees the annotation once per statement. Rejected: annotating only the result node's statement.
6. **PR #30642 (ports).** Decided: it stays open and is rebased onto slice `filtered-many-writes` when that slice exists. Rejected: closing it now and opening a new ports PR later.
7. **Capability check for the `connect` conflict clause.** Decided: none. `connect` uses the conflict clause whenever the junction has the key; both current targets render it, and a target that cannot is a decision for whoever adds it.
8. **Relation with no link columns.** Decided: the contract validator rejects a relation whose link-column lists are empty (minimum length 1 on `on.localFields`, `on.targetFields` and the three `through` column lists). The ORM has no check of its own; the executor's four guards are removed with it and not replaced. Rejected: one check in the graph's translation; no check anywhere.
9. **A relation field that is not a callback** (`update({ posts: 'x' })`). Decided: rejected while the graph is built with `ORM.RELATION_MUTATION_INVALID`, saying the relation takes a callback. Main takes the plain path and reports `ORM.FIELD_UNKNOWN` ("has no field"), or resolves `null` when no row matches. Third deliberate behaviour change in slice `graph-nested`.
10. **Fixtures for the remaining matrix suites.** Decided: `nested_upsert_inside_update.rs` and `combining_different_nested_mutations.rs` use the `_fixture/` directory the two ported matrix suites already share; a variant it lacks is added there. This extends the layout exception granted for those two suites and does not change the written port rule. Rejected: a fixture copy per suite.

## References

- Linear Project: none; the project is not tracked in Linear. The working branch stays `nested-mutations`.
- Sibling project: [`projects/port-all-tests/`](../port-all-tests/spec.md) — upstream test ledgers; nested-mutation entries in `checklists/engines-writes.md`.
- Prior project on the same surface: [`projects/sql-orm-many-to-many/`](../sql-orm-many-to-many/spec.md).
- Code: `packages/3-extensions/sql-orm-client/src/relation-mutator.ts`, `src/mutation-executor.ts` (removed by stage 1), `src/types.ts` (`RelationMutator`), `src/collection.ts` (`upsert`, `updateAll`, `deleteAll`); `packages/2-sql/4-lanes/relational-core/src/ast/types.ts` (`DoUpdateSetConflictAction`).
- Design-discussion records: the operations in this spec come from the 2026-10-06 discussion, whose rejected alternatives are listed below. The mutation graph comes from the 2026-10-09 discussion, recorded with its rejected alternatives in [`mutation-graph.md`](./mutation-graph.md).

### Alternatives rejected in discussion

| Alternative | Why rejected |
| --- | --- |
| One operation per relation per call | Makes the upstream tests that combine operations non-portable |
| `updateMany` / `deleteMany` names | Two names for one concept in one client |
| Filter as an argument, `r.updateAll(where, data)` | A second spelling of a filtered write, different from the collection's |
| Nested upsert that updates whatever row conflicts | An update on one parent would change a row belonging to another |
| Nested upsert that moves a conflicting row to this parent | Takes a child from another parent as a side effect |
| Read the related row, then write (Prisma 7's mechanism) | Two statements where one conditional statement gives the same guarantee |
| Scoping only 1:N and leaving M:N and to-one unscoped | Inconsistent rule; the link condition exists on every layout |
| Synthesised driver error with SQLSTATE 23505 | Claims a database error that did not occur |
| Leaving conflict skipping out of nested `create` | The top-level option already exists; without the nested form one upstream test stays non-portable |
| `onConflict: 'skip'` on many-to-many, leaving a skipped target unlinked | Callers there want the existing row linked; Prisma 7 offers skip on one-to-many only |
| A separate `connectOrCreate({ where, create })` operation | The conflict option on `create` covers it without a second way to name the row |
| For connect: skip on conflict, then select the skipped rows | Two statements per call where an update-on-conflict returns the row in one |
| To-one upsert that works without a unique foreign key (update, then insert if nothing was updated) | Two statements, and it would update several rows when the key is not unique; PSL and TypeScript authoring would keep disagreeing on what a valid `1:1` is |
| Choosing the one- or two-statement form at runtime from the contract's constraints | Two code paths for one layout |
| Deleting junction rows before many-to-many `deleteAll` | The ORM does not handle referential actions elsewhere; the schema's action decides |
