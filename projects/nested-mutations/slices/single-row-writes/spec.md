# Slice: single-row-writes

Parent project `projects/nested-mutations/`. This slice delivers updating and deleting one related row inside `update()`, on to-one and to-many relations, working as the collection's own `update` and `delete` do, and refuses `disconnect` on a relation whose foreign key is required. Added to the project on 2026-11-13; before that the project spec listed nested single-row `update` and `delete` as a non-goal.

## At a glance

A relation callback in `update()` data can return `r.update(data)` or `r.delete()` on a to-one relation, and `r.where(w).update(data)` or `r.where(w).delete()` on a to-one or to-many relation. On a to-one relation the row is the linked row; on a to-many relation it is the first related row the filter matches, as the collection's `update` and `delete` change the first row their filter matches. When no related row matches, nothing changes and nothing is raised. `disconnect` on a required relation, which today sends `SET fk = NULL` and fails with the database's NOT NULL error, is refused by the types and while the graph is built, with the same rule as `delete`. The upstream engine tests for nested `update` and `delete` inside `update` are ported.

## Chosen design

### Surface

Illustrative; re-verify names against shipped code.

```ts
await db.User.where({ id: 1 }).update({
  profile: (p) => p.update({ bio: 'New' }),
  posts: (p) => [
    p.where({ id: 3 }).update({ title: 'Renamed' }),
    p.where({ published: false }).delete(),
  ],
});

await db.Post.where({ id: 1 }).update({
  author: (a) => a.where({ active: false }).delete(),
});
```

- **To-many relations (1:N and M:N):** `r.where(w).update(data)` and `r.where(w).delete()`. `update` and `delete` without a `where` are a type error and are rejected at runtime, as on the collection.
- **To-one relations (N:1 and 1:1):** `r.update(data)` and `r.delete()`, and the same after `r.where(w)`, which narrows the linked row: if the linked row does not match, nothing changes.
- The narrowed mutator `where` returns gains `update` and `delete` beside `updateAll` and `deleteAll`; on a to-one relation it has only `update` and `delete`, since `updateAll` and `deleteAll` stay to-many only.
- `update` data is the related model's scalar fields in their input types, as in `updateAll`. It takes no relation callbacks.
- The first matching row among several is unspecified: the mutator has no `orderBy`, as the collection's `update` without `orderBy` (decided 2026-11-13).
- No row matched, or no row linked: no change, no error (decided 2026-11-13).

### Descriptors

Two operations join the union, `update` (state and data) and `delete` (state), with the state of the collection `where` returned, as `updateAll` and `deleteAll` hold it.

### Execution

Built on the first-row builders of the collection's `update` and `delete` (`updateFirstGraph` / `deleteFirstGraph`: a `Find … limit 1`, then the write by key), with a `FilterData` edge from the parent, as `updateAll` and `deleteAll` are built on the top-level `updateAll`/`deleteAll` builders. There is no `Assert`.

| Relation layout | Row | `update` | `delete` |
| --- | --- | --- | --- |
| Child holds the key (1:N, 1:1) | `Find … limit 1` on the child with the caller's filter and an edge from the parent's key to the child's foreign key | the first-row update | the first-row delete |
| Junction (M:N) | the same `Find`, with the junction subquery of `filtered-many-writes` and the edge into it | the first-row update | the first-row delete; junction rows are left to the database's foreign-key action, as in `deleteAll` |
| Parent holds the key (N:1) | the target row whose key the parent's foreign key holds, through an edge from the parent's row to the target's key, with the caller's filter | the update | the parent's foreign key is set to null in the parent's update, then the target row is deleted, its key read from the parent row before the update |

- On 1:1 with the key on the child, at most one row is related; the slice may write without the `Find` when that keeps the graph smaller, and the graph tests pin whichever it builds.
- A parent whose foreign key is null has no linked row: nothing changes.
- `update` applies the related model's update defaults, and rejects data or defaults that set the parent link, as `updateAll` does.
- Operations on one relation are added in array order; table state orders operations on the same table.

### Rejections

Runtime and types, with the same builder-typed-contract limit as `filtered-many-writes`.

- `update`, `delete` inside `create()`: `ORM.RELATION_MUTATION_UNSUPPORTED`.
- `delete` on a required N:1 relation: `ORM.RELATION_MUTATION_UNSUPPORTED`, because the parent's foreign key cannot be set to null (decided 2026-11-13; Prisma 7 offers `delete` only on optional to-one relations).
- `update` or `delete` on a to-many relation without `where`: `ORM.RELATION_MUTATION_INVALID`.
- `update` data that sets the field linking the row to the parent: `ORM.RELATION_MUTATION_INVALID` (`problem: 'parent-link-column'`), as for `updateAll`.

### `disconnect` on a required relation

Today `disconnect` checks no nullability: on N:1 it sets the parent's foreign key to null in the parent's update, on 1:N and 1:1 it sets the children's foreign key to null, and on a required relation the database refuses the statement with a NOT NULL error that reaches the caller unwrapped. This has been so since nested mutations were added (February 2026); the graph slices kept it. After this slice (decided 2026-11-13):

- `disconnect` on N:1 whose parent foreign key is required, and on 1:N or 1:1 whose child foreign key is required: `ORM.RELATION_MUTATION_UNSUPPORTED` while the graph is built, before any statement, and a type error where the contract types carry the fields' nullability.
- M:N `disconnect` is unchanged: it deletes a junction row and sets nothing to null.
- `delete` on N:1 uses the same check, so the two share one rule: an operation that sets a foreign key to null is refused when that key is required.
- Behaviour change for callers that relied on the database error; the upgrade entry says so.

### `disconnect` criteria on N:1

Today `r.disconnect(criteria)` on an N:1 relation ignores its criteria: the translation adds the parent's foreign key, set to null, to the parent's own update, so the parent is unlinked whatever row it is linked to. The types and the README offer the criteria on every relation but M:N; on 1:N and 1:1 they are applied. Found in review of PR #31021; present since nested mutations were added. After this slice (decided 2026-11-13, as Prisma 7's to-one `disconnect: { where }`):

- `disconnect()` with no criteria on N:1 is unchanged: the foreign key is set to null in the parent's update.
- `disconnect(criteria)` on N:1 unlinks only when the linked row matches one of the criteria: a separate `Update` of the parent, `SET fk = NULL WHERE <parent key> AND fk IN (SELECT key FROM target WHERE <criterion>)`, with the parent's `FilterData` edge, after the parent's own update. A composite key uses row-value `IN`, as in `filtered-many-writes`.
- No match: no change, no error, as for `update` and `delete`.
- Behaviour change for callers whose criteria did not match the linked row; the upgrade entry says so.

## Coherence rationale

Two operations that share one selection of the row per relation layout and the first-row builders the collection already has. `update` and `delete` share all their selection code, so splitting them would duplicate the review. The ports exercise exactly these operations.

## Scope

**In:**
- `packages/3-extensions/sql-orm-client`: mutator and descriptor types, `relation-mutator.ts`, `relation-mutations.ts`, the translation in `mutation-graph/nested-mutations.ts`, unit, graph and type tests.
- Integration tests on Postgres and SQLite for each layout, including a related row that does not match and an unrelated row that matches the filter, both left unchanged.
- Ports into `test/integration/test/ports/engines/`, one representative fixture per relation shape as in `filtered-many-writes` (option C), reusing its `_fixture/` directories where they fit:
  - `writes/nested_mutations/not_using_schema_base/nested_update_inside_update.rs` (16)
  - `writes/nested_mutations/already_converted/nested_delete_inside_update.rs` (22)
  - `packages/client/tests/functional/blog-update` from `prisma/prisma`, whose ledger entry is removed
- `projects/port-all-tests/checklists/` and the ledgers.
- `disconnect` criteria applied on N:1, with graph tests and integration tests where the linked row matches and where it does not.
- The required-relation check for `disconnect`, with type tests and integration tests on a required N:1 and a required 1:N relation; the integration tests that disconnect a required relation, if any, are edited.
- Package README and error reference.
- An `upgrade-instructions/pending/` entry: `disconnect` on a required relation is now an ORM error and a type error, and `disconnect(criteria)` on N:1 unlinks only when the linked row matches.

**Out:**
- `orderBy` on the nested mutator.
- `set`, `connectOrCreate`, `upsert` (slice `nested-upsert`).
- The tests in the three relation-key files that mix single-row `delete` with `upsert` (slice `nested-upsert` decides them).

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
| --- | --- | --- |
| No related row matches, or the to-one relation is not linked | No change, no error | Upstream raises P2025 (e.g. `p1_c1_error_if_not_connected`). The port asserts the rows are unchanged; the checklist records the difference |
| `delete` on a required to-one relation | Rejected on N:1; allowed on 1:1 with the key on the child | Upstream offers `delete` only on optional to-one relations |
| `disconnect(criteria)` on N:1 when the linked row does not match | No change | Prisma 8 unlinked regardless until this slice (review of PR #31021) |
| `disconnect` on a required relation | Rejected | Upstream offers to-one `disconnect` only on optional relations, and raises P2014 on a required 1:N; Prisma 8 raised the database's NOT NULL error until this slice |
| Upstream tests generated over a matrix of relation links | One representative variant per relation shape | As in `filtered-many-writes` |

## Slice-specific done conditions

- [ ] Each of the 38 upstream tests listed under Scope has a disposition in the `port-all-tests` checklists, and none is left unported for lack of nested `update` or `delete`.

## Open Questions

- `orderBy` on the nested mutator, so that the first matching row of a to-many `update`/`delete` can be chosen.

## References

- Parent project: `projects/nested-mutations/spec.md`, `projects/nested-mutations/plan.md`
- Collection `update`/`delete`: `packages/3-extensions/sql-orm-client/src/collection.ts`; `updateFirstGraph`, `deleteFirstGraph` in `src/mutation-graph/collection-graphs.ts`
- Previous slice: `projects/nested-mutations/slices/filtered-many-writes/spec.md`
- Upstream sources: `prisma/prisma-engines` at `e922089b7d7502aff4249d5da3420f6fa55fc6ad`; `prisma/prisma` at `a6d01554`
