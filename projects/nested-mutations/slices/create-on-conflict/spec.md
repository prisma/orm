# Slice: create-on-conflict

Parent project `projects/nested-mutations/`. This slice delivers creating a related row or linking the one that already exists, and skipping related rows that collide, in the same call that writes the parent.

## At a glance

Nested `create` takes a second argument, `{ onConflict: 'skip' | 'connect', conflictOn? }`, in `create()` and `update()`. `'skip'` leaves out colliding rows on one-to-many relations. `'connect'` links the existing row on every relation layout and leaves its other fields unchanged; it takes the place of Prisma 7's `connectOrCreate`. A row that cannot collide with any key the option watches is rejected before any statement runs, in nested `create` and in top-level `createAll` / `createAndCount`. The upstream engine tests for nested `connectOrCreate` and `createMany` with `skipDuplicates` are ported.

## Chosen design

### Surface

Illustrative; re-verify names against shipped code.

```ts
await db.User.where({ id: 1 }).update({
  posts: (p) => [
    p.create([{ slug: 'a', title: 'A' }, { slug: 'b', title: 'B' }], { onConflict: 'skip' }),
    p.create({ slug: 'shared', title: 'Shared' }, { onConflict: 'connect', conflictOn: ['slug'] }),
  ],
  tags: (t) => t.create({ id: 'sql' }, { onConflict: 'connect' }),
});
```

- The options type is a new nested options type: `onConflict` is `'skip' | 'connect'`, `conflictOn` is the related model's scalar field names, as in `CreateConflictOptions`. `CreateConflictOptions` and top-level `createAll` keep `'skip'` only.
- Both overloads of the mutator's `create` (one row, an array of rows) take the options. The descriptor `RelationMutationCreate` gains an optional `options` field.
- `'skip'` is offered by the types on one-to-many relations only. On a to-one or many-to-many relation the options type has `onConflict: 'connect'` only. The limit of slice `filtered-many-writes` applies: the cardinality is a literal type in an emitted `contract.d.ts`, not in a contract typed directly from the TypeScript builder, where the rejection is at runtime only.

### Which keys a row can conflict on

The conflict keys of a call:

| Option | `conflictOn` given | `conflictOn` omitted |
| --- | --- | --- |
| `'skip'` | the named columns | every primary key and unique constraint of the table |
| `'connect'` | the named columns | the primary key |

A row can conflict when it gives a non-null value for every column of at least one conflict key. Values count when they come from the row's own data, from the parent link (the foreign key a child-held relation fills in from the parent), from a to-one relation write inside the row (`connect` or `create` on a relation whose key the row holds, which fills that key before the insert), or from a create default the ORM fills in (a generated `cuid()`, `uuid()`, `now()` and the like). The third source was added during dispatch 3 (2026-11-13), under the rule that only a row that cannot conflict is rejected. A column the database fills in (auto-increment, database default) and `null` do not count.

A row that cannot conflict is rejected while the graph is built, before any statement runs (decided 2026-11-13):

- nested `create`: `ORM.RELATION_MUTATION_INVALID`, `meta` with the relation, the row's index and the conflict columns;
- top-level `createAll(rows, { onConflict: 'skip' })` and `createAndCount(rows, { onConflict: 'skip' })`: `ORM.ARGUMENT_INVALID`, the code `#resolveConflictSkip` uses, `meta` with the method, the model, the row's index and the conflict columns.

The check is one function over the storage rows after defaults are applied, used by both paths. For top-level calls this is a behaviour change: a call that inserted such rows before now throws. It gets an `upgrade-instructions/pending/` entry for app authors.

### Statements

`'skip'` is the existing `ON CONFLICT … DO NOTHING` clause (`InsertConflictSkip`), with `createAll`'s capability checks (`assertInsertConflictSkipCapability`).

`'connect'` is an insert with `ON CONFLICT (<conflict columns>) DO UPDATE SET …`, so the database returns the row whether it inserted it or found it:

| Relation layout | `DO UPDATE SET` | Link |
| --- | --- | --- |
| Child holds the key (1:N, 1:1 child-held) | the link columns to `excluded.<column>` | the update itself; a child linked to another parent moves to this one, as plain `connect` |
| Parent holds the key (N:1, 1:1 parent-held) | the first conflict column to `excluded.<column>` | the parent's foreign key, from the row by a `PayloadData` edge, as nested `create` today |
| Junction (M:N) | the first conflict column to `excluded.<column>` | a junction insert reading the target key by a `PayloadData` edge, with the conflict clause of plain junction `connect` (`ON CONFLICT DO NOTHING` when the junction has a key over exactly its link columns, a plain insert otherwise) |

The second and third rows assign a column its own proposed value; the costs listed under "Must be resolved before the project closes" in the project spec (triggers, row lock, `UPDATE` privilege, generated column) apply to them as to top-level `upsert`.

- **One insert per row for `'connect'`.** A statement that updates on conflict cannot touch the same row twice on Postgres, so two rows of one call that collide with each other or with the same existing row would fail there and not on SQLite.
- **`'skip'` batches as `createAll`.** When no row has relation callbacks, the rows go into one insert (or the column-set groups `addInsert` makes); when any row has relation callbacks, every row gets an insert of its own, as nested `create` does today.
- **Reading the row.** A `'connect'` insert that a link edge or a nested child reads is followed by a read-back by its conflict columns (`FindByKeys`), as `upsertGraph` builds it, and the readers read the read-back. With capability `returning` the read-back rule collapses it into the insert. Without it, the node checks of design record D19 apply as they are: the insert is refused when a column read from it is updated or not given by the row.
- **Without `insertOnConflictTarget`.** `'connect'` applies top-level `upsert`'s check (`requireOnlyCollidingKey`): it is refused when the row can also collide on a key other than the conflict columns.

### Relation callbacks inside a row

- `'skip'`: a skipped row's insert returns no row, so its callbacks have no parent row and do not run. Without `returning` this is refused by the existing check for skipped rows that are read.
- `'connect'`: callbacks run under the row the insert returns, whether it was inserted or already existed (decided 2026-11-13). A nested `create` under an existing row adds children to it.

### Rejections

Each at runtime, while the graph is built; the type-level ones as described under Surface.

- `onConflict: 'skip'` on a to-one (`N:1`, `1:1`) or many-to-many relation: `ORM.RELATION_MUTATION_UNSUPPORTED`.
- An `onConflict` value other than `'skip'` or `'connect'`, or `conflictOn` naming a field the model does not have: `ORM.RELATION_MUTATION_INVALID`.
- Either value when the relation's target model is a variant stored in its own table: `ORM.RELATION_MUTATION_UNSUPPORTED`, as top-level `createAll` refuses the option. Slice `nested-variant-creates` adds `variant()` to the mutator; whichever of the two merges second applies the same check to a create through `variant()`.
- A row that cannot conflict: above.

## Coherence rationale

Both options are one argument on one mutator method, share the conflict-key rule, the row check and the translation entry for nested `create`, and are ported from one upstream concept (Prisma 7's conflict handling on nested creates). The slice is larger than one review, so it ships as three PRs that each leave main consistent:

1. **Options and `'skip'`** (about 550 lines): the options type and descriptor, parsing and rejections, the conflict-key rule and the row check for nested and top-level calls, `'skip'` on one-to-many, graph and integration tests, the upgrade entry, the README paragraph for `'skip'`. `'connect'` is not offered by the types yet and is rejected at runtime.
2. **`'connect'`** (about 600 lines): the conflict clause per layout, the read-back, the capability check, graph tests per layout, integration tests on Postgres and SQLite including an unrelated row that matches the conflict columns, the README paragraph for `'connect'`.
3. **Ports** (about 600 lines): the six upstream files, their fixtures, the checklists and ledgers.

## Scope

**In:**
- `packages/3-extensions/sql-orm-client`: the nested options type and `RelationMutator.create` in `types.ts`, `relation-mutator.ts`, `relation-mutations.ts`, the translation in `mutation-graph/nested-mutations.ts`, the conflict clause in `mutation-statements.ts`, the row check and its call in `collection.ts` for `createAll` / `createAndCount`, unit, graph and type tests.
- Integration tests under `test/integration/test/sql-orm-client/`, on Postgres and SQLite: each option on each layout it is valid on, in `create()` and `update()`; for `'connect'`, an unrelated row that matches the conflict columns is linked and its other fields are unchanged; for `'skip'`, a colliding row is left unchanged and unlinked, and its callbacks do not run.
- Ports into `test/integration/test/ports/engines/`, with their fixtures:
  - `writes/nested_mutations/not_using_schema_base/nested_create_many.rs` (5); the `no_error_on_dups_when_skip_dups` entry in `engines/non-ported.md` is removed
  - `writes/nested_mutations/not_using_schema_base/nested_connect_or_create.rs` (6)
  - `writes/regressions/prisma_11731.rs` (2)
  - `writes/regressions/if_node_siblig_dep_regression.rs` (1)
  - `queries/order_and_pagination/nested_pagination.rs` › the three `m2m_many_children_*` tests that build their data with `connectOrCreate`
  - `new/regressions/prisma_27452.rs` (1)
- `projects/port-all-tests/checklists/` and the ledgers for those tests.
- Package README: one section on nested `create` options. `docs/reference/error-reference.md` is not changed: the slice adds no error code.
- An `upgrade-instructions/pending/` entry for the top-level row check.

**Out:**
- `onConflict: 'connect'` on top-level `createAll`.
- Nested writes inside top-level `upsert` (`query_reordering_works`, `one2one_upsert_if_no_child_connected_yet`, `prisma_27452`): their ledger entries name what is still missing.
- A separate `where` for `'connect'`.
- Telling inserted rows from existing ones in a `'connect'` result.
- `variant()` on the mutator (slice `nested-variant-creates`).

## Pre-investigated edge cases

From the upstream tests being ported.

| Edge case | Disposition | Notes |
| --- | --- | --- |
| `connectOrCreate` whose `create` data contradicts its `where` | The port writes the `where` value into the row; if the result differs from Prisma 7's, a failing port with a ledger entry | `m2n_connect_or_create` (`create: { id: "Doesn't matter" }`), `one2one_inlined_parent` |
| Conflict column given by the parent link | Counts as a value; the conflict fires on it | `prisma_11731` › `one2one_inlined_child`, `conflictOn: ['itemId']` |
| `'connect'` on 1:N in `create()` moves an existing child from another parent | Linked to the new parent, as plain `connect` | `one_req_2m_connect_or_create`, `one2m_connect_or_create` |
| 1:1 child-held `'connect'` of the child already linked to this parent | No change, no error | `one2one_update_if_no_child_connected_yet` |
| 1:1 child-held `'connect'` when the parent already has another child | The database's unique violation on the foreign key, as plain `connect` | Prisma 7 disconnects the old child first; not part of the ports in scope |
| Two parent-held `'connect'`s on one `create()` | Both rows are written before the parent | `if_node_siblig_dep_regression` |
| Nested pagination tests that need nested cursor, skip or take on includes | Port the data setup with `'connect'`; any test that also needs a missing read feature stays unported with a ledger entry naming it | `nested_pagination.rs` |

## Slice-specific done conditions

- [ ] Each upstream test listed under Scope has a disposition in the `port-all-tests` checklists, and none is left unported or recorded as non-portable for lack of nested conflict options.

## Open Questions

None.

## Plan amendments to record (project plan is not edited by this slice)

1. The row check (a row that cannot conflict is rejected) is added to nested `create` and to top-level `createAll` / `createAndCount` with `onConflict: 'skip'`; the top-level part is a behaviour change with an upgrade entry (decided 2026-11-13).
2. Relation callbacks inside a `'connect'` row run under the returned row, existing or new (decided 2026-11-13).
3. The slice ships as three PRs (options and `'skip'`, `'connect'`, ports).
4. `nested_pagination.rs` contributes its three `m2m_many_children_*` tests; the plan's count of 3 refers to these.

## References

- Parent project: `projects/nested-mutations/spec.md`, plan on branch `nested-mutation-unique-key-writes` (PR [#31026](https://github.com/prisma/orm/pull/31026))
- Design record: `projects/nested-mutations/mutation-graph.md` (D7 read-back rule, D18, D19)
- Upstream sources: `prisma/prisma-engines` at `e922089b7d7502aff4249d5da3420f6fa55fc6ad`, under `query-engine/connector-test-kit-rs/query-engine-tests/tests/`
- Port corpus rules: `test/integration/test/ports/README.md`
- Code: `src/collection.ts` (`CreateConflictOptions`, `#resolveConflictSkip`, `createAll`, `createAndCount`), `src/collection-contract.ts` (`assertInsertConflictSkipCapability`, `resolveInsertConflictColumns`), `src/mutation-graph/collection-graphs.ts` (`upsertGraph`, `requireOnlyCollidingKey`), `src/mutation-graph/nested-mutations.ts` (`addChildOwned`, `addParentOwned`, `addJunctionOwned`, `linkKeyConflict`), `src/mutation-graph/model-statements.ts` (`addInsert`, `insertRows`, `readBack`), `src/mutation-graph/own-values.ts`
- Docs overlap: PR [#31021](https://github.com/prisma/orm/pull/31021) changes the README and the error reference; this slice adds one README section and leaves the error reference alone.
