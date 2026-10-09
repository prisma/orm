## Dispatch plan

> Superseded. This plan built the slice on the nested-write executor (PR #30634, closed without merging). The slice is rebuilt on the mutation graph after stage 1 of `projects/nested-mutations/plan.md`; this plan is rewritten when the slice is picked up.

Slice spec: `projects/nested-mutations/slices/filtered-many-writes/spec.md`. Six dispatches, sequential. Tests are written before the implementation in every dispatch that changes source.

### Dispatch 1: array returns from relation callbacks

- **Outcome:** A relation callback in `create()` or `update()` may return a readonly array of the existing operations (`create`, `connect`, `disconnect`); they are applied in array order; an empty array is a no-op; a nested array or a non-descriptor element is rejected with `ORM.RELATION_MUTATION_INVALID`. A callback that returns a single operation behaves as before. Covered by unit tests, type tests and integration tests on Postgres and SQLite, and by the port of `combining_different_nested_mutations.rs` › `create_then_disconnect`.
- **Builds on:** The slice spec's chosen design.
- **Hands to:** A relation-callback return type and a parser/executor that carry a list of operations per relation, in order. Later dispatches add operation kinds to that list without changing how it is carried.
- **Focus:** The callback return type, `parseMutationInput`, and the executor's per-relation application in both `createGraph` and `updateFirstGraph`. `disconnect` stays rejected in `create()`, including inside an array. The executor's order across relations does not change. No new operation kinds here.

### Dispatch 2: `where`, `updateAll`, `deleteAll` on one-to-many

- **Outcome:** On a one-to-many relation inside `update()`, `r.where(w).updateAll(data)`, `r.where(w).deleteAll()`, `r.updateAll(data)` and `r.deleteAll()` work as the slice spec describes: every filter form the collection's `where()` accepts, chained `where` combined with AND, update defaults applied, empty data issuing no statement, zero matches not an error, only rows whose foreign key equals the parent's key affected. The three rejections in the spec hold in the types and at runtime: inside `create()`, on a to-one relation, and `updateAll` data that sets a column linking the child to this parent. Covered by unit tests, type tests and integration tests on Postgres and SQLite, including one test per operation where a row of another parent matches the filter and is unchanged.
- **Builds on:** Dispatch 1's ordered list of operations per relation.
- **Hands to:** The narrowed mutator returned by `where`, the `updateAll` and `deleteAll` descriptors, and their one-to-many execution. Many-to-many relations reject these operations with a clear error until dispatch 3.
- **Focus:** Mutator and descriptor types, `relation-mutator.ts`, the child-owned path in the executor. Many-to-many is dispatch 3. Ports are dispatches 4 and 5.

### Dispatch 3: `updateAll` and `deleteAll` on many-to-many

- **Outcome:** The same four call shapes work on a many-to-many relation: one statement on the target table, limited to targets that have a junction row to this parent and match the filter. `deleteAll` issues no statement on the junction table. Covered by integration tests on Postgres and SQLite, including a target linked only to another parent that matches the filter and is unchanged, and a `deleteAll` case for each of: junction foreign keys that cascade, and junction foreign keys that do not (the database's error surfaces and the whole update is rolled back).
- **Builds on:** Dispatch 2's descriptors and narrowed mutator.
- **Hands to:** `updateAll` and `deleteAll` complete on every relation layout they are valid on. The surface the ports need is finished.
- **Focus:** The junction path in the executor only. No change to the mutator's types beyond lifting the temporary many-to-many rejection.

### Dispatch 4: port the nested `updateMany` and `deleteMany` suites

- **Outcome:** Every test of `nested_update_many_inside_update.rs` (8) and `nested_delete_many_inside_update.rs` (6) is ported into `test/integration/test/ports/engines/writes/nested_mutations/` with its fixtures, following `test/integration/test/ports/README.md`. Each is passing, or failing with an entry in `engines/failing.md` that states the Prisma 8 difference. The `port-all-tests` checklist entries for these 14 tests are checked off with their disposition.
- **Builds on:** Dispatch 3's complete `updateAll` / `deleteAll`.
- **Hands to:** The two main suites ported; a fixture and test layout for nested-mutation ports that dispatch 5 reuses.
- **Focus:** Ports only; no source changes. These suites use `relation_link_test`, which runs each test over a matrix of schema variants for one pair of relation sides; port against the variants Prisma 8's PSL can express and record the others. The two tests that assert rejection on a to-one relation (`one2n_rel_error_nested_um`, `o2n_rel_fail`) assert Prisma 8's rejection. If a port shows a behaviour gap in dispatches 2–3, stop and report it; do not adjust the assertion to pass.

### Dispatch 5: port the remaining tests and correct the ledgers

- **Outcome:** Ported with the same rules as dispatch 4: `unchecked_nested_update_many.rs` (4), `top_level_mutations/delete_many.rs` › `nested_delete_many`, `new/regressions/prisma_8265.rs` › `nested_update_many_timestamps`, `queries/filters/filter_unwrap.rs` › `many_filter`. `engines/non-ported/queries/filters/filter_unwrap/filter_unwrap.md` is deleted. `prisma/non-ported/functional/blog-update/blog-update.md` names only the missing single-row nested `update`. Checklist entries for these seven tests are checked off.
- **Builds on:** Dispatch 4's port layout.
- **Hands to:** All 22 upstream tests in the slice's scope have a disposition; no ledger entry cites a missing nested `updateMany` or `deleteMany`.
- **Focus:** Ports and ledgers only. MongoDB and CockroachDB variants (`allow_write_autoinc_id_cockroachdb`) are recorded as not applicable, not ported.

### Dispatch 6: documentation and upgrade declaration

- **Outcome:** The `sql-orm-client` README and the user-facing query docs describe `where().updateAll()`, `where().deleteAll()`, the array return, and the rule that these operations touch only rows related to the parent, with the difference from the collection (no `where` required). An `upgrade-instructions/pending/` entry declares no required changes. `pnpm check:upgrade-coverage` passes for the branch.
- **Builds on:** Dispatch 3's finished surface.
- **Hands to:** The slice ready for its full gate run and PR.
- **Focus:** Docs describe behaviour, not implementation. No mention of `projects/` paths in long-lived files.

### Dispatch 7: nested input is validated before the parent row is looked up

- **Outcome:** In `update()`, nested relation input is parsed and every rejection that does not depend on the parent row's values is raised before the parent row is looked up. An `update()` whose filter matches no row therefore rejects malformed or unsupported nested input instead of resolving `null`. The port of `disallow_write_parent_inline_rel_sclrs` passes as a plain test; its `it.fails` marker and its `engines/failing.md` entry are removed.
- **Builds on:** Dispatch 5's port, which showed the gap: upstream runs that test on an empty database and expects the rejection.
- **Hands to:** The slice's rejections hold at runtime whether or not the filter matches a row, as the slice spec states.
- **Focus:** The order of parsing and lookup in the update path of `mutation-executor.ts`, for every nested operation kind, including the pre-existing ones. An `update()` with valid nested input and no matching row still resolves `null` and writes nothing. Added after dispatch 5 reported; not in the original plan.
