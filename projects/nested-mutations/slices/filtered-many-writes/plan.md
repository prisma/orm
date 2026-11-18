## Dispatch plan

Slice spec: `projects/nested-mutations/slices/filtered-many-writes/spec.md`. Built on the mutation graph, on top of slice `write-builders` (branch `mutation-graph-filtered-many-writes`). Six dispatches, sequential. Tests are written before the implementation in every dispatch that changes source. PR #30634 (branch `nested-mutations`) and PR #30642 (branch `nested-mutations-ports`) were built on the executor: their types, type tests, integration tests, docs and ports are reused; their source changes are not. This plan replaces the executor plan of 2026-10-14.

### Dispatch 1: array returns from relation callbacks

- **Outcome:** A relation callback in `create()` or `update()` may return a readonly array of the existing operations (`create`, `connect`, `disconnect`); they are added to the graph in array order; an empty array is a no-op; a nested array or a non-descriptor element is rejected with `ORM.RELATION_MUTATION_INVALID`. A callback that returns one operation behaves as before. Covered by unit, graph and type tests and by integration tests on Postgres and SQLite, and by the port of `combining_different_nested_mutations.rs` › `create_then_disconnect`.
- **Builds on:** Slice `write-builders`' translation in `mutation-graph/nested-mutations.ts`.
- **Hands to:** `parseMutationInput` and the translation carry a list of operations per relation, in order. Later dispatches add operation kinds to that list.
- **Focus:** The callback return type, `parseMutationInput`, the translation's per-relation loop. `disconnect` stays rejected in `create()`, inside an array too. No new operation kinds.

### Dispatch 2: `where`, `updateAll`, `deleteAll` on one-to-many

- **Outcome:** On a one-to-many relation inside `update()`, `r.where(w).updateAll(data)`, `r.where(w).deleteAll()`, `r.updateAll(data)` and `r.deleteAll()` work as the spec describes: an `Update`/`Delete` on the child table with the caller's filter and a `FilterData` edge from the parent to the child's foreign key; every filter form the collection's `where()` accepts; chained `where` combined with AND; update defaults applied; empty data adds no node; zero matches not an error. The three rejections hold in the types and at runtime: inside `create()`, on a to-one relation, and `updateAll` data that sets a column linking the child to this parent. Covered by graph tests (printed graphs), type tests and integration tests on Postgres and SQLite, including one test per operation where a row of another parent matches the filter and is unchanged.
- **Builds on:** Dispatch 1's ordered list of operations per relation.
- **Hands to:** The narrowed mutator returned by `where`, the `updateAll` and `deleteAll` descriptors, and their one-to-many translation. Many-to-many rejects these operations with a clear error until dispatch 3.
- **Focus:** Mutator and descriptor types (from #30634), `relation-mutator.ts`, the child-held branch of the translation.

### Dispatch 3: many-to-many through a junction subquery

- **Outcome:** The same four call shapes work on a many-to-many relation as one `Update`/`Delete` on the target table with `target.key IN (SELECT j.target_fk FROM junction j)` and a `FilterData` edge from the parent to `j.parent_fk`, whose condition goes into the subquery. `FilterData` conditions are placed in the `SELECT` whose `FROM` alias matches the edge's target column alias. Composite keys use a row-value `IN`, added to the SQL AST and rendered by the Postgres, SQLite and MySQL adapters. Covered by AST and adapter rendering tests, graph tests, and integration tests on Postgres and SQLite: a target linked only to another parent that matches the filter is unchanged; a composite-key target; `deleteAll` with junction foreign keys that cascade, and with ones that do not (the database's error surfaces and the whole update is rolled back); a `connect` then `updateAll` in one array that sees the new link.
- **Builds on:** Dispatch 2's descriptors and narrowed mutator.
- **Hands to:** `updateAll` and `deleteAll` complete on every relation layout they are valid on.
- **Focus:** `filtered-statement.ts` (alias routing), the junction branch of the translation, the row-value `IN` in relational-core and the three adapters. No junction `Find` node and no new rule.

### Dispatch 4: port the nested `updateMany` and `deleteMany` suites

- **Outcome:** Every test of `nested_update_many_inside_update.rs` (8) and `nested_delete_many_inside_update.rs` (6) is ported into `test/integration/test/ports/engines/writes/nested_mutations/` with its fixtures, following `test/integration/test/ports/README.md`, starting from #30642's ports. Each passes, or fails with an entry in `engines/failing.md` that states the Prisma 8 difference. The port of `disallow_write_parent_inline_rel_sclrs` passes as a plain test, on an empty database. The `port-all-tests` checklist entries for these 14 tests are checked off.
- **Builds on:** Dispatch 3.
- **Hands to:** The two main suites ported; the fixture layout dispatch 5 reuses.
- **Focus:** Ports only. If a port shows a behaviour gap in dispatches 1–3, stop and report it; do not change the assertion to pass.

### Dispatch 5: port the remaining tests and correct the ledgers

- **Outcome:** Ported with the same rules: `unchecked_nested_update_many.rs` (4), `top_level_mutations/delete_many.rs` › `nested_delete_many`, `new/regressions/prisma_8265.rs` › `nested_update_many_timestamps`, `queries/filters/filter_unwrap.rs` › `many_filter`. `engines/non-ported/queries/filters/filter_unwrap/filter_unwrap.md` is deleted. `prisma/non-ported/functional/blog-update/blog-update.md` names only the missing single-row nested `update`. Checklist entries for these seven tests are checked off.
- **Builds on:** Dispatch 4's port layout.
- **Hands to:** All 22 upstream tests in scope have a disposition.
- **Focus:** Ports and ledgers. MongoDB and CockroachDB variants are recorded as not applicable.

### Dispatch 6: documentation and upgrade declaration

- **Outcome:** The `sql-orm-client` README and the user-facing query docs describe `where().updateAll()`, `where().deleteAll()`, the array return, and the rule that these operations touch only rows related to the parent, with the difference from the collection (no `where` required), starting from #30634's text. An `upgrade-instructions/pending/` entry declares no required changes. `pnpm check:upgrade-coverage` passes.
- **Builds on:** Dispatch 3's finished surface.
- **Hands to:** The slice ready for its gate run and PR.
- **Focus:** Docs describe behaviour, not implementation. No `projects/` paths in long-lived files.
