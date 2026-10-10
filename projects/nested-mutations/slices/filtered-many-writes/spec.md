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

Two operations join the existing `create` / `connect` / `disconnect` union, as `updateAll` (filters and data) and `deleteAll` (filters). The descriptor check in `relation-mutator.ts` and the parser in `mutation-executor.ts` (`parseMutationInput`) accept them and accept an array of descriptors.

The mutator is created today with no knowledge of the relation (`createRelationMutator()` takes no arguments). The callback form of `where` needs the related model's accessor, so the mutator must be given the relation's target model, or `where` must store its input for the executor to resolve. Either is acceptable; the filter forms accepted must match the collection's.

### Execution

All statements run in the scope the nested update already opens.

| Relation layout | `updateAll` | `deleteAll` |
| --- | --- | --- |
| Child holds the key (1:N) | one `UPDATE` on the child table where the foreign key equals the parent's key and the filter holds | one `DELETE` with the same condition |
| Junction (M:N) | one `UPDATE` on the target table for rows that have a junction row to this parent and match the filter | one `DELETE` on the target table with the same condition; junction rows are not touched by the ORM |

- `updateAll` applies the related model's update defaults, as the collection's `updateAll` does. An `updateAll` whose data is empty issues no statement.
- Operations on one relation run in array order. The executor's order across relations is unchanged: parent-owned relations before the parent row is written, child-owned and junction relations after.
- Zero matching rows is not an error.

### Rejections

Each is rejected at runtime. Each is also rejected by the types, with one limit: the to-one and parent-link rejections need the relation's cardinality and link fields as literal types, which an emitted `contract.d.ts` carries and a contract typed directly from the TypeScript builder does not. On a builder-typed contract those two are rejected at runtime only. The existing type-level rules for junction relations have the same limit. The `create()` rejection depends only on context and holds on both.

- `where`, `updateAll`, `deleteAll` inside `create()`: `ORM.RELATION_MUTATION_UNSUPPORTED`, the code `disconnect` in `create()` uses today.
- `where`, `updateAll`, `deleteAll` on a to-one relation (`N:1` and `1:1`): `ORM.RELATION_MUTATION_UNSUPPORTED`.
- `updateAll` data that sets a column linking the child to this parent: `ORM.RELATION_MUTATION_INVALID`, the code for malformed nested input.

## Coherence rationale

Everything here is one change to the relation mutator and the executor's dispatch: two more operation kinds that share a filter and a scoping condition, and the array return that lets them be combined with the existing kinds. The ports exercise exactly these operations. `updateAll` and `deleteAll` share all their filter and scoping code, so splitting them would duplicate the review; the array return is small and is needed by this slice's own ports.

## Scope

**In:**
- `packages/3-extensions/sql-orm-client`: `RelationMutator` and descriptor types, `relation-mutator.ts`, `mutation-executor.ts`, unit and type tests.
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
- Code: `packages/3-extensions/sql-orm-client/src/relation-mutator.ts`, `src/mutation-executor.ts` (`parseMutationInput`, `updateFirstGraph`, `createGraph`), `src/types.ts` (`RelationMutator`, `RelationMutation`); existing tests `test/relation-mutator.test.ts`, `test/mutation-executor.test.ts`, `test/integration/test/sql-orm-client/nested-mutations.test.ts`, `mn-nested-write.test.ts`
