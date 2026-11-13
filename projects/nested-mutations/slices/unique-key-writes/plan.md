## Dispatch plan

Slice spec: `projects/nested-mutations/slices/unique-key-writes/spec.md`. Two dispatches, sequential. Tests first in each. One PR, about 400 lines, based on the top of the filtered-many-writes stack (branch `nested-mutation-unique-key-writes`).

### Dispatch 1: the condition check and the first-row builders

- **Outcome:** `pinsUniqueKey` is in `src/mutation-graph/unique-condition.ts` with its unit tests (the uncommitted draft and its 17 tests are reviewed against the spec and kept or corrected). `updateFirstGraph` and `deleteFirstGraph` build the `Find` without `limit` and `orderBy` and give the write the same condition object when the check holds and the state has no `offset` and no `cursor`. Graph tests in `test/mutation-graph/collection-graphs.test.ts` print, after `removeUnreadFinds`, a lone `Update` for `update()` and a lone `Delete` returning the selected columns for `delete()` by primary key, by a unique constraint, by chained `where`s over a composite key and by the callback form, and keep `Find … limit 1` for an offset, a cursor, a part of a composite key and a condition that does not pin a key; `delete()` with includes keeps a `Find` without a limit and a `Delete` by key; a nested write reading the `Find` keeps it. Existing unit tests whose printed graphs or recorded statements change are updated. `pnpm test` and `pnpm typecheck` in `packages/3-extensions/sql-orm-client` and `pnpm lint` pass.
- **Builds on:** The spec's chosen design; the fold rule, delete rule and `removeUnreadFinds` as they are.
- **Hands to:** First-row builders that send one statement for a key condition on a contract with `returning`, with graph tests pinning each case.
- **Focus:** No rule changes and no new collection state. Results are unchanged; `delete()` already takes the first row of a `Delete`'s result.

### Dispatch 2: integration tests and the design record

- **Outcome:** Integration tests on Postgres and SQLite under `test/integration/test/sql-orm-client/` show that `where({ id }).update(…)`, `whereUnique(…).update(…)` and `where({ id }).delete()` send one statement, recorded by the runtime's executions, and return the same row as before, and `null` for a missing row; a condition that does not pin a key still sends two. Existing integration tests whose statement counts change are updated. Design record D10b's sentence that `delete()` keeps its `Find … LIMIT 1` is amended to say when it does. The integration files this slice touches pass locally on both targets; the root `pnpm build` passes.
- **Builds on:** Dispatch 1's builders.
- **Hands to:** The slice ready for its PR.
- **Focus:** The full integration suite runs in CI; locally only the touched files.
