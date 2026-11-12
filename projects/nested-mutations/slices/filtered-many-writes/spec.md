# Slice: filtered-many-writes

Parent project `projects/nested-mutations/`. This slice delivers updating and deleting a filtered set of related rows inside `update()`, and lets one relation take several operations in one call.

## At a glance

A relation callback in `update()` data can return `r.where(w).updateAll(data)` or `r.where(w).deleteAll()`, with `where` optional, on one-to-many and many-to-many relations. A relation callback in `create()` or `update()` can return an array of operations, applied in order. The upstream engine tests for nested `updateMany` and `deleteMany` are ported. Slice `nested-upsert` builds on the array return and the mutator shape introduced here.

## Chosen design

### Surface

Illustrative; re-verify names against shipped code.

```ts
await db.User.where({ id: 1 }).update({
  posts: (p) => [
    p.create({ title: 'New' }),
    p.where({ published: false }).updateAll({ published: true }),
    p.where((post) => post.title.like('Draft%')).deleteAll(),
    p.deleteAll(),
  ],
});
```

- `r.where(input)` accepts every form the collection's `where()` accepts for the related model: a callback over the related model's accessor, a shorthand object, or a direct expression. It returns a narrowed mutator that has only `where`, `updateAll` and `deleteAll`. Chained `where` calls combine with AND, as on a collection.
- `r.updateAll(data)` and `r.deleteAll()` are also callable on the mutator directly, with no `where`. They then apply to every row related to the parent. This differs from the collection, where both require a preceding `where`; the parent already limits the rows.
- `updateAll` data is the related model's scalar fields, as in the collection's `updateAll`. It takes no relation callbacks.
- A relation callback returns one operation or a readonly array of operations. An empty array is a no-op. Arrays do not nest.

### Descriptors

Two operations join the existing `create` / `connect` / `disconnect` union, as `updateAll` (filters and data) and `deleteAll` (filters). `where` stores its input on the narrowed mutator; the translation resolves it against the related model, so every filter form the collection's `where()` accepts is accepted (as in PR #30634). The descriptor check in `relation-mutator.ts` and `parseMutationInput` in `relation-mutations.ts` accept the two new kinds and an array of descriptors.

### Execution

Built on the mutation graph (`src/mutation-graph/nested-mutations.ts`), after slice `write-builders`. Nested `updateAll` and `deleteAll` are count writes: nothing reads them, so no rule applies and nothing changes between databases with and without `RETURNING`. Updated 2026-11-12 for the graph; the executor design this section replaced built the same statements.

| Relation layout | `updateAll` | `deleteAll` |
| --- | --- | --- |
| Child holds the key (1:N) | one `Update` on the child table with the caller's filter, and a `FilterData` edge from the parent's node to the child's foreign key columns: `UPDATE child SET … WHERE <filter> AND child.fk = <parent key>` | one `Delete` with the same condition and edge |
| Junction (M:N) | one `Update` on the target table whose condition is the caller's filter and `target.key IN (SELECT j.target_fk FROM junction j)`, with a `FilterData` edge from the parent's node to `j.parent_fk` | one `Delete` with the same condition and edge; junction rows are not touched by the ORM, the database's foreign-key action decides |

- **Edges reach a subquery by alias (decided 2026-11-12, option B).** A `FilterData` edge's condition goes into the `SELECT` whose `FROM` alias is the alias of the edge's target column: the outer statement's `WHERE` for an outer alias, as every edge does today, and the subquery's `WHERE` for the junction alias. The translation builds the junction subquery itself; there is no junction `Find` node and no inlining rule. This replaces the inlining step of design record D8 (a junction `Find` inlined by a peephole); D8's statement form, `IN (SELECT …)`, and its reason, a statement that does not grow with the relation, stand. A later slice that needs the junction rows as a node adds a junction `Find` then.
- **Composite keys use row-value `IN`**: `(t.k1, t.k2) IN (SELECT j.k1, j.k2 FROM …)`. The form is added to the SQL AST and rendered by the Postgres, SQLite and MySQL adapters.
- `updateAll` applies the related model's update defaults, as the collection's `updateAll` does. An `updateAll` whose data is empty adds no node.
- Operations on one relation are added in array order; table state orders operations on the same table, including a junction `connect`/`disconnect` before a many-to-many `updateAll`/`deleteAll` in the same array (the write reads the junction's state through its subquery). The order across relations is unchanged: parent-held relations before the parent row is written, child-held and junction relations after.
- Zero matching rows is not an error.
- Nested input is parsed and rejected while the graph is built, before any statement runs, so an `update()` whose filter matches no row still rejects unsupported nested input.

### Rejections

Each is rejected at runtime. Each is also rejected by the types, with one limit: the to-one and parent-link rejections need the relation's cardinality and link fields as literal types, which an emitted `contract.d.ts` carries and a contract typed directly from the TypeScript builder does not. On a builder-typed contract those two are rejected at runtime only. The existing type-level rules for junction relations have the same limit. The `create()` rejection depends only on context and holds on both.

- `where`, `updateAll`, `deleteAll` inside `create()`: `ORM.RELATION_MUTATION_UNSUPPORTED`, the code `disconnect` in `create()` uses today.
- `where`, `updateAll`, `deleteAll` on a to-one relation (`N:1` and `1:1`): `ORM.RELATION_MUTATION_UNSUPPORTED`.
- `updateAll` data that sets a column linking the child to this parent: `ORM.RELATION_MUTATION_INVALID`, the code for malformed nested input.

## Coherence rationale

Everything here is one change to the relation mutator and the executor's dispatch: two more operation kinds that share a filter and a scoping condition, and the array return that lets them be combined with the existing kinds. The ports exercise exactly these operations. `updateAll` and `deleteAll` share all their filter and scoping code, so splitting them would duplicate the review; the array return is small and is needed by this slice's own ports.

## Scope

**In:**
- `packages/3-extensions/sql-orm-client`: `RelationMutator` and descriptor types, `relation-mutator.ts`, `relation-mutations.ts`, the translation in `mutation-graph/nested-mutations.ts`, the alias-routed conditions in `mutation-graph/filtered-statement.ts`, unit, graph and type tests.
- The row-value form of `IN` in `packages/2-sql-family/4-lanes/relational-core` (SQL AST) and its rendering in the Postgres, SQLite and MySQL adapters.
- Integration tests under `test/integration/test/sql-orm-client/`, on Postgres and SQLite, including for each operation a test where an unrelated row matches the filter and is left unchanged.
- Ports into `test/integration/test/ports/engines/`, with their fixtures:
  - `writes/nested_mutations/already_converted/nested_update_many_inside_update.rs` (8)
  - `writes/nested_mutations/already_converted/nested_delete_many_inside_update.rs` (6)
  - `writes/unchecked_writes/unchecked_nested_update_many.rs` (4)
  - `writes/top_level_mutations/delete_many.rs` › `nested_delete_many` (1)
  - `new/regressions/prisma_8265.rs` › `nested_update_many_timestamps` (1)
  - `queries/filters/filter_unwrap.rs` › `many_filter` (1); its non-ported file is removed
  - `writes/nested_mutations/combining_different_nested_mutations.rs` › `create_then_disconnect` (1)
- `projects/port-all-tests/checklists/` and the ledgers: each ported test checked off with its disposition; `blog-update.md` rewritten to name only the missing single-row `update`.
- Package README and user-facing query docs for the two operations, the array return, and the rule that they touch only rows related to the parent.
- An `upgrade-instructions/pending/` entry declaring no required changes.

**Out:**
- `upsert`, and the conflict options on nested `create` (other slices).
- Single-row nested `update` and `delete`, `set`, `connectOrCreate`.
- The other four tests of `combining_different_nested_mutations.rs`.
- The three relation-key files that mix `updateMany`/`deleteMany` with `upsert` (ported by `nested-upsert`).
- MongoDB variants of the ported tests.
- The collection's own `updateAll`/`deleteAll`.

## Pre-investigated edge cases

From the upstream tests being ported.

| Edge case | Disposition | Notes |
| --- | --- | --- |
| Empty filter | Applies to all rows related to the parent | `pm_c1_req_empty_filter`, `pm_c1_req_work_empty_filter` |
| No row matches | No change, no error | `pm_c1_req_noop_no_hit`, `pm_c1_req_no_change_if_no_hit` |
| Several operations whose filters overlap | Applied in array order; the last write wins per row | `pm_c1_req_many_ums`, `pm_c1_req_many_filters`, `pm_c1_req_many_delete_manys` |
| Operation used on a to-one relation | Rejected | Upstream fails with 2009 "Field does not exist in enclosing type" (`one2n_rel_error_nested_um`, `o2n_rel_fail`). The port asserts Prisma 8's rejection; if a faithful assertion cannot pass, it is a failing port with a ledger entry |
| `updateAll` data sets the foreign key that links to the parent | Rejected | `disallow_write_parent_inline_rel_sclrs`. Setting another relation's foreign key is allowed (`allow_write_non_prent_inline_rel_sclrs`) |
| `updateAll` sets `@updatedAt` fields | Update defaults are applied | `nested_update_many_timestamps` |
| Many-to-many `deleteAll` when a target is linked from elsewhere, or junction rows have no cascade | The database's foreign-key action decides; the ORM issues no junction delete | Project decision. `pm_cm_should_work` may need the fixture's junction keys to cascade to be a faithful port; if it cannot pass as upstream wrote it, it is a failing port with a ledger entry |
| Upstream tests generated over a matrix of relation links | Port against the layouts Prisma 8's PSL can express | These suites use `relation_link_test`, which runs each test over several schema variants |

## Slice-specific done conditions

- [ ] Each of the 22 upstream tests listed under Scope has a disposition in the `port-all-tests` checklists, and none is left unported for lack of `updateAll`, `deleteAll` or the array return.
- [ ] `engines/non-ported/queries/filters/filter_unwrap/filter_unwrap.md` no longer exists.

## Open Questions

None.

## References

- Parent project: `projects/nested-mutations/spec.md`, `projects/nested-mutations/plan.md`
- Upstream sources: `prisma/prisma-engines` at `e922089b7d7502aff4249d5da3420f6fa55fc6ad`, under `query-engine/connector-test-kit-rs/query-engine-tests/tests/`
- Port corpus rules: `test/integration/test/ports/README.md`
- Code: `packages/3-extensions/sql-orm-client/src/relation-mutator.ts`, `src/relation-mutations.ts` (`parseMutationInput`), `src/mutation-graph/nested-mutations.ts` (`addChildOwned`, `addJunctionOwned`), `src/mutation-graph/filtered-statement.ts`, `src/types.ts` (`RelationMutator`, `RelationMutation`); existing tests `test/relation-mutator.test.ts`, `test/mutation-graph/*`, `test/integration/test/sql-orm-client/nested-mutations.test.ts`, `mn-nested-write.test.ts`
- Reused work: PR #30634 (branch `nested-mutations`: mutator types, type tests, integration tests, README and error-reference text, upgrade entry) and PR #30642 (branch `nested-mutations-ports`: the ports), both built on the executor; their source changes are not reused
