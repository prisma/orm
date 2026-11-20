## Dispatch plan

Slice spec: `projects/nested-mutations/slices/read-back-reuse/spec.md`. Two dispatches, sequential. Tests first in each. One PR, estimated at about 600 lines, based on `main` at 59303e2eec75c (branch `nested-mutation-read-back-reuse`). If the diff passes about 1,000 lines, dispatch 2 becomes a second PR stacked on the first.

Gates for both dispatches, run in `packages/3-extensions/sql-orm-client`: `pnpm test`, `pnpm typecheck` (and the test project if the script covers only `src`), `pnpm lint`. The full integration and e2e suites are not run locally.

### Stacked PRs (added 2026-11-20, after dispatch 2)

The branch came to about 1,600 lines, of which 88 are source, so it is delivered as three stacked PRs. The split is by what each PR changes for a caller, not by dispatch.

| PR | Branch | Base | Holds |
| --- | --- | --- | --- |
| 1 | `nested-mutation-read-back-reuse` | `main` | The spec and plan; `reuseRule`, `rowsOfTableReadOf`, `rulesFor`; the rule's unit tests and the `read-back-rule.test.ts` edits; the 16 statement counts of relation-only updates with includes loaded per relation; design record D7; its own upgrade-coverage declaration. With the rule alone, `updateFirstGraph` still decides by the flag, so only updates with includes loaded per relation change. |
| 2 | `nested-mutation-read-back-reuse-2` | PR 1 | `updateFirstGraph` always adds the read-back; `BeforeWrite.unlinksAfterWrite` removed; the graph tests of the statements table and the three updated graph tests; the README; the Postgres integration tests; its own upgrade-coverage declaration. The results that change, change here. |
| 3 | `nested-mutation-read-back-reuse-3` | PR 2 | The SQLite integration tests. |

On PR 1's branch the changed-result integration tests of PR 2 and PR 3 are run once and seen failing, since no run against the code before the slice exists; the run is recorded in PR 2's description.

### Dispatch 1: the rule, the builder and the flag

- **Outcome:** `reuseRule` exists in `src/statement-graph/` with the four conditions of the spec and a doc comment in the form of the three existing rules, and `rulesFor` returns it on every contract. `updateFirstGraph` always adds the read-back in the branch that sends no `UPDATE` of the record. `BeforeWrite.unlinksAfterWrite` no longer exists. Unit tests of the rule cover, on a contract with and without `returning`: it applies; it does not apply after a write to the table, after a write whose declared foreign-key action changes the table, for a source with joins, `DISTINCT` or grouping, for a read-back with a condition, an order or includes, and for an edge that does not cover a key; and when it applies the source selects the read-back's columns. Graph tests of `updateFirstGraph` pin each row of the spec's "Statements per call" table, including a nested write on a model related to itself and a base model with a variant in its own table. Existing graph tests whose printed graph changes are updated, and each change is one the table predicts. The gates pass.
- **Builds on:** The spec's chosen design; `readBack`, `readsByKey`, `readsTableAsFound`, `conditionOnlyReadOf` and `Find.withReturning` as they are.
- **Hands to:** A relation-only `update()` whose read-back is decided by state edges, with graph tests for every case, for dispatch 2 to check against databases.
- **Focus:** The rule's source pattern allows a condition, an order, a limit, an offset and locking, and refuses `DISTINCT`, `DISTINCT ON`, `GROUP BY`, `HAVING` and joins; `rule-patterns.ts` has no function for exactly that today. The branch that sends an `UPDATE` and the `bare` branch are not touched. A printed graph that changes outside the spec's table is reported, not adjusted.

### Dispatch 2: integration tests and docs

- **Outcome:** Integration tests under `test/integration/test/sql-orm-client/` on Postgres and SQLite show the five results of the spec's "Results that change" table as the database holds them, and that these stay as they are: a relation-only `update()` with a `select`, with includes under both include strategies, with an N:1 `delete`, and on a contract without `returning`. One test on each target, with and without `returning`, shows a relation-only `update()` that writes no row of the record's table sends one `SELECT` of that table. Existing integration tests whose statement counts change are updated. The package README has the two sentences the spec names. Design record D7 names the fourth rule and says which rules need `returning`. The upgrade-coverage declaration for the change exists. The integration files this dispatch touches pass locally on both targets; the root `pnpm build` passes; `pnpm check:upgrade-coverage --mode pr --prev $(git rev-parse origin/main) --head HEAD` passes.
- **Builds on:** Dispatch 1's rule and builder.
- **Hands to:** The slice ready for its PR.
- **Focus:** The foreign-key action case needs a contract that declares the action; the fixtures under `test/integration/test/sql-orm-client/fixtures/self-relations/` do not declare one, and the probe added it with raw SQL. A result that differs from the spec's table is reported before the test is changed to match it.
