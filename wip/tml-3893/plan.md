# Dispatch plan: a statement sent on a single-connection Postgres client waits for an open transaction to end

- Spec: [spec.md](./spec.md). Read it first; this plan does not repeat it.
- Linear ticket: TML-3893. Branch: `tml-3893-postgres-serverless-client-a-query-sent-outside-an`, cut from `origin/main`. One pull request.
- Status: not started. Revised on 2026-11-20 after the system design and engineering reviews. Nothing is built until Will says to build it.

## Roles and models

| Role | Who | Model and effort |
| --- | --- | --- |
| Orchestrator | this session (morpheus-11) | Fable, medium |
| Implementer | one subagent per dispatch | Opus, medium |
| Reviewer inside the loop, and both `/drive-code-review` reviewers | subagents | Opus, high |

The orchestrator writes no production code and runs no test suites. It writes briefs, checks each returned diff against the spec, and writes the pull request text.

## Rules that go in every brief

- Work only inside the worktree `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/postgres-serverless-transaction-query-516034`. No files in `/tmp` or any temp directory; working files go under `wip/`.
- Run `node` and `pnpm` through `mise exec --`. Use `pnpm`, never `npx`.
- Never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all` in full. Run test files by path. `pnpm build` in full is fine; never build one package.
- Packages outside the driver load it from `dist`. Run `pnpm build` after every change to the driver or the runtime, before running any facade, Supabase, integration or example test.
- Save slow command output to a file under `wip/` once and read the file.
- Never change `packages/1-framework`. If the work seems to need it, stop and report.
- Tests are written before the code they test. Test names omit "should". Use the shared `timeouts` helper, never raw numbers. A test file stays under 500 lines.
- No code comments unless the code cannot say it. No bare `as` casts in production code. No `any`.
- Commit with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`, staging files by name. No "Co-Authored-By" or "Generated with" lines. Never amend, squash, rebase, force-push, stash, reset or check out another branch. Do not push.
- Markdown prose is never hard-wrapped.
- A test that did not run is reported as "not run", never as passed. The MySQL and MariaDB live tests skip without `MYSQL_URL` and `MARIADB_URL`.
- Failure modes from `drive/calibration/failure-modes.md` that apply, to be reported as avoided: destructive git operations by a subagent (F5); a regression test that does not discriminate (F13); checks that do not mirror CI (F14); a stale `dist` that makes a red check look like a broken base (F24); a "pre-existing failure" claimed without running the file on clean `main` (F25); a test file no suite runs (F28); a test double that returns what the real dependency never returns (F33); test filters after `--` being dropped (F40); a safety check moved to a new mechanism where one path that fed the old check does not feed the new one (F45).
- Checks every dispatch runs before reporting: `pnpm typecheck`; `pnpm --filter <pkg> lint` and `pnpm --filter <pkg> test` for each touched package; the touched integration test files by path; `pnpm lint:vitest-timeouts`; `pnpm lint:deps` if imports changed.
- The report says: what changed, each command run with its result, which tests are red or green and why, and anything that contradicts the spec. A contradiction stops the dispatch; it is not worked around.

## Dispatches

### 1. Tests that show the defect

**Outcome.** The tests of spec sections A, C, D and E exist on the branch, such that a statement on the client that runs inside an open transaction makes a test fail on every SQL client. No production code changes.

**Builds on.** `origin/main`.

**Work.**
- Create the branch.
- Extend the driver's recording fake client with a per-statement hold. Write section A in a new file in `packages/3-targets/postgres/3-driver/test/`.
- Write the target-neutral scenario helper in `@repo/test-utils`. Write section C's runs for the Postgres pooled client (pool `max` 2 or more), the serverless connection, the `pg.Client` client, Supabase, MySQL and MariaDB (body in `suites/`, one-line runners), and the SQLite test. Follow the spec's rules for starting and capturing statements.
- Write section D with the mocked `pg.Client`, and section E's new facade test.
- Write C4 in `test/integration/test/` beside the `runtime.verify-marker.*` tests.
- Run each new file. Record, per test and per client, red or green and the failure message.
- Run the SQLite write case once, outside the committed test, and record what happens (the spec predicts a 5-second stall and "database is locked").
- Run the ticket's reproduction script (spec section F) and save its output under `wip/tml-3893/`. Check `docker info` first and say which database was used.

**Completed when.**
- A1 to A4, A9 to A11 and A13 are red, C1 and C2 are red on both single-connection Postgres clients, and D is red. Each failure is the defect (a wrong order on the socket, a rolled-back write, a 25P02 error, an uncommitted row read), not a harness error or an unhandled rejection.
- A5 to A8, A12, C3, C4, E and every pooled run are green.
- For each green test the report says how it can fail.
- MySQL, MariaDB and Supabase results are stated, or stated as "not run" with the reason.
- The SQLite write result is stated.
- `pnpm typecheck`, the touched packages' lint, and `pnpm lint:vitest-timeouts` pass. Red tests are committed as they are; the branch is not pushed in this state.

**Stop and report if.** A pooled client is red. The defect does not reproduce on `main`. The SQLite read test is red.

**Hands to dispatch 2.** A branch whose only red tests are the ones the fix must turn green, with the list of them.

### 2. The marker read in the runtime

**Outcome.** In the SQL runtime, a statement on a held connection or transaction never awaits a marker read that is pending on the driver, such that a first statement on a transaction can always proceed while a first statement on the client waits for that transaction, on any driver.

This goes before the driver change, because the driver change alone turns C4 into a hang.

**Builds on.** Dispatch 1's branch.

**Work.**
- Write section B (B1 to B4) in `packages/2-sql-family/5-runtime/test/`, with a fake driver whose statements on the driver wait until a held connection is released. See them hang or fail.
- Change `setupDriverExecution` in `packages/2-sql-family/5-runtime/src/sql-runtime.ts` to the rule in spec design point 5 and test B4.
- `pnpm build`, then run the existing marker tests in `test/integration/test/` (`runtime.verify-marker.*`) and C4.

**Completed when.**
- B1 to B4 are green, and B1, B3 and B4 were seen to hang or fail before the change.
- The runtime package's tests and the `runtime.verify-marker.*` integration files pass. C4 passes.
- The public interface of the runtime is unchanged, and nothing in `packages/1-framework` changed.
- Coverage thresholds hold: run vitest with coverage from the repository root on the runtime package's path, and confirm the output applies the thresholds.

**Stop and report if.** The rule cannot be met without changing a framework type or the driver interface.

**Hands to dispatch 3.** A runtime that is safe for a driver whose statements wait for held connections.

### 3. The fix in the driver

**Outcome.** In `PostgresDirectDriverImpl`, a statement on the driver takes the lease in `acquireClient()` and releases it in `releaseClient()`, such that no statement on the driver is sent on a held connection's session, for connections that are released after their transaction ends by `COMMIT` or `ROLLBACK`. The pool driver and the framework are unchanged.

**Builds on.** Dispatches 1 and 2.

**Work.**
- Make the change in `packages/3-targets/postgres/3-driver/src/postgres-driver.ts`, as spec design points 3 and 4 say: split the connect-and-settings step out of `acquireClient()`; the lease-taking `acquireClient()` is used by statements on the driver; `acquireConnection()` uses the private step.
- The five mistakes the engineering review predicts, each to be reported as avoided: taking the lease in `acquireClient()` without the split; wrapping the public `query()` generator; not releasing the lease when a step after it throws; checking closed-or-lost before waiting for the lease; forgetting the marker read (done in dispatch 2).
- Rewrite the four existing driver tests listed in the spec.
- Add the `SqlDriver` doc comment sentence (spec design point 6) and fix the source comments in `postgres-driver.ts` that describe the old behaviour.
- `pnpm build`, then run sections C, D, E, including the named integration and e2e files in section E.
- Remove-the-fix check: revert the driver change in the working tree, `pnpm build`, run sections A, C and D and see them red; restore, `pnpm build`, see them green.
- Run the reproduction script again and save the "after" output.

**Completed when.**
- Every test from dispatches 1 and 2 is green, with none weakened, skipped or deleted. A changed assertion is listed in the report with the reason.
- The whole test suites of `packages/3-targets/postgres/3-driver`, `packages/3-targets/postgres/9-facade`, `packages/2-sql-family/5-runtime` and `packages/3-extensions/supabase` pass, and the section E files pass.
- Coverage thresholds hold for the driver, checked from the repository root.
- `pnpm typecheck`, lint for touched packages, `pnpm lint:deps`, `pnpm lint:ratchets` and `pnpm lint:vitest-timeouts` pass.
- The remove-the-fix check was done with a build on both halves.
- The Cloudflare example's integration test passed, or is stated as "not run: needs Docker".

**Stop and report if.** The fix needs a change outside the driver package other than the doc comment. A test hangs for a reason the spec does not name.

**Hands to dispatch 4.** A green branch with the behaviour final.

### 4. Documents and upgrade instructions

**Outcome.** Every document that describes this behaviour says what the code now does, such that no current document tells a reader that a statement on the client runs inside an open transaction.

**Builds on.** Dispatch 3's final behaviour. Each claim is checked against the code and tests, not copied from the spec.

**Work.** Everything under "Decision record" and "Documents" in the spec. In particular:
- Choose the new record's number after checking `main` and open pull requests. Follow `.agents/rules/adr-writing.mdc`, `adr-examples-must-match-code.mdc` and the `write-architecture-docs` skill.
- Search `docs/`, `skills/`, `upgrade-instructions/`, `packages/**/README.md`, `examples/` and the driver's source comments for the old behaviour, and fix every instance, not only the listed ones.
- Write the upgrade instructions with the `record-upgrade-instructions` skill: an `app` declaration with prose and an `extension` declaration with `changes: []`.

**Completed when.**
- The search returns nothing outside the superseded record on the afterTransaction stage.
- `pnpm check:upgrade-coverage --mode pr --prev $(git rev-parse origin/main) --head HEAD`, `pnpm lint:docs` and `pnpm lint:consumer-internal-imports` pass.
- No long-lived file refers to `wip/` or `projects/`.

**Hands to review.** A complete branch.

## After the dispatches

1. **Review inside the loop.** After each dispatch, a reviewer (Opus, high) checks the diff against the spec. It runs the tests; it does not only read them. Findings are fixed before the next dispatch.
2. **File the two tickets** named in the spec's done conditions, after searching Linear for existing ones: the SQLite write beside a transaction, and a connection released with its transaction open.
3. **`/drive-code-review`**, without the walkthrough, on the branch tip. Fix its findings. Run it again if the fixes are large.
4. **Merge `origin/main`** into the branch, `pnpm build`, then re-run the touched test files, `pnpm lint:ratchets` and `pnpm check:upgrade-coverage`.
5. **Manual check.** Compare the "before" and "after" outputs of the ticket's reproduction. Then, with a serverless connection, run the `Promise.all` example from the spec by hand with a rollback, and confirm in the statement log that no statement on the client sits between `BEGIN` and `ROLLBACK`.
6. **Walk the slice definition of done** in `drive/calibration/dod.md`, item by item. Items that apply beyond the checks above: `pnpm size:build` in `examples/bundle-size` on the branch and on `main`, because code the runtime reaches changes; every review thread resolved before auto-merge.
7. **Pull request.** Title: `TML-3893: <a sentence saying what a user can now do>`. The description opens with the `Promise.all` example and its result before and after, states the decision, then the behaviour table, the tests, and the alternatives last. It carries `Fixes TML-3893` and the line `Agent: morpheus-11`. Pushed through the `bot` remote. Auto-fix on at once; auto-merge on once approved; a background command waits for the merge.
8. **Final verification by Will.**

## What is deferred

- Rejecting a statement on the client sent from inside the transaction callback: TML-3899.
- A default transaction timeout, and cancelling a statement that waits for the lease: not filed; raise them only if Will asks.
