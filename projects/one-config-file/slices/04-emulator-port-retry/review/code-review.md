# Code review: prisma/composer#333

Branch `fix/dev-emulators-port-retry` against `main` (three-dot), head `27562e65`. 14 files, +222/−99.

## Summary

The PR fixes two defects in the dev-emulators "fresh-allocation port retry" test:

- The test read the daemon log before the "listening on" line was written.
- The test never reached the retry path, because `get-port` locks every port it returns inside the calling process.

A fixture now binds the allocated port on the daemon's first start, so the daemon's own bind fails and `ensureDaemon` retries. A helper waits for the listening-line count to settle. The PR also adds `PRISMA_COMPOSER_EMULATORS_DIR` to override the registry root, refuses relative values with `DEV.EMULATORS_DIR_INVALID`, and exports `emulatorRegistryRoot()` for the integration proofs.

Verification I ran on the branch head:

- `pnpm test` in dev-emulators: 72 pass, 0 fail. `daemon.test.ts` alone: 21 pass.
- The target package's `emulator-registry-root.test.ts` passes.
- Root `pnpm lint` and `pnpm lint:deps` pass.
- Typecheck passes for dev-emulators, `@internal/prisma-cloud` and `@prisma/integration-tests` (29 turbo tasks).
- A scratch probe drove `ensureFreshDaemon` with the fixture. The daemon log shows `Failed to start server. Is port 4307 in use?`, then `compute-main listening on 127.0.0.1:4308`. The retry really runs.
- A scratch bun test confirmed that `toThrow(expect.objectContaining({ code, message }))` fails when either field differs, so the relative-path assertion can fail.

I did not run the integration proofs.

## What looks solid

- The fixture fails the bind at the real call site. The holder server and the daemon share one process. The daemon's `server.listen` has no `'error'` listener, so `EADDRINUSE` crashes the process and frees the port. `awaitHealthy` sees the exit, and `ensureDaemon` retries from `port + 1`. The test does not depend on the old port being released.
- `expect(resultPort).toBeGreaterThan(takenPort)` alone proves a retry happened. If the bind had succeeded, the daemon would sit on `takenPort`.
- The retry test asserts the exact listening line with `toEqual`, so a duplicate line or a wrong port fails it.
- `defaultRegistryRoot()` treats an empty value as unset, which suits CI templates that blank variables. Relative values are refused with a why, a fix and a `meta` field naming the variable.
- The variable reaches every process that needs it. `run-alchemy.ts` spreads `process.env` into the alchemy child. `toStructured` passes the structured error through unchanged in `execute-dev.ts` (emulators and `--fresh` teardown) and in the log attach path.
- The integration proofs' cleanup still stops only the daemons they started. They read registry entries and delete files under the same `emulatorRegistryRoot()` (`local-dev.integration.ts` lines 654–672).

## Findings

### F01 — The settle loop waits for only one quiet 500 ms window (low)

`packages/1-prisma-cloud/0-lowering/dev-emulators/src/__tests__/daemon.test.ts` lines 57–77.

Issue: `awaitListeningLines` returns as soon as two reads 500 ms apart see the same count. It also returns whatever it has at the 5 s deadline, without saying the count was still changing. A duplicate line that arrives more than 500 ms after the previous read would be missed, and the test would pass. In practice the risk is small. Both `ensure` calls in the concurrent test have already passed a health check, so any second daemon is already up, and only the `listen` callback lag remains. The PR measured that lag at under 300 ms. Separately, `readFileSync` throws `ENOENT` inside `waitFor`'s predicate, so a missing log fails the test at once instead of being retried. Both callers create the log before calling, so this does not happen today.

Suggestion: state the 300 ms measurement next to the 500 ms window so the next reader knows the margin. Optionally, treat a missing log as zero lines.

### F02 — `skipContendedDaemonPorts`'s comment describes behaviour that does not happen (low)

`packages/1-prisma-cloud/0-lowering/dev-emulators/src/__tests__/helpers.ts` lines 128–138.

Issue: the helper calls `getPort` to find the first free port. `get-port` then locks that port inside the test process, so `ensureDaemon` skips it and starts the daemon on the next free port above it. A probe confirmed this: the helper got 4305, and the next allocation was 4307. The PR's own description explains the same locking for the old test. The daemon still lands on a free port, so nothing breaks, but the comment says the "first daemon starts on a free port" as if it were the one found.

Suggestion: reword the comment to say the daemon starts above the found port, because `get-port` holds that port in this process.

### F03 — Edge cases of the variable's value (low)

`packages/1-prisma-cloud/0-lowering/dev-emulators/src/daemon.ts` lines 117–137.

Issue: the value is returned as typed, without normalisation. `/x/emulators/` and `/x/emulators` name the same files. Symlinked spellings also resolve to the same registry, because identity comes from the filesystem and `proper-lockfile` resolves the real path. The strings that `emulatorRegistryRoot()` returns still differ, though, and callers that compare them will disagree. A quoted `~/emulators` (common in YAML and `.env` files, where `~` is not expanded) is refused as relative. That refusal is correct, but the message does not explain why. Windows drive paths are irrelevant because `dev` refuses to run on Windows (`DEV.PLATFORM_UNSUPPORTED`). The `why`, `fix` and `meta` fields are not asserted.

Suggestion: return `path.normalize(dir)`. Add "`~` is not expanded" to the fix text. Extend the relative-path test to assert `meta.variable`.

### F04 — Nothing tests that the error reaches the CLI (low)

`packages/0-framework/3-tooling/cli/src/operations/execute-dev.ts` lines 118–127. `packages/1-prisma-cloud/1-extensions/target/src/local-target/emulators.ts` line 43.

Issue: by reading the code, `prisma-composer dev` with a relative value fails in the emulators phase with `DEV.EMULATORS_DIR_INVALID`, exit status 2, and the why and fix lines. With `--fresh` it fails earlier, in teardown, with the same code. `prisma-composer log` would surface a `DEV.*` code from the `LOG` operation. No test covers any of these paths, and the ADR-0044 entry is the only record of the code.

Suggestion: add one `execute-dev` unit test with a stub `emulators` hook that throws the error, asserting that `notOk` carries the code unchanged. Or accept the read-through and note it in the PR.

### F05 — The integration proofs read the variable, but nothing sets it (low)

`test/integration/test/local-dev.integration.ts`, `local-dev-store.integration.ts`, `local-dev-criteria-4-5.integration.ts`. `.github/` sets no `PRISMA_COMPOSER_*` variable.

Issue: in CI the proofs still use `~/.prisma-composer/emulators`. That is fine on ephemeral runners. The benefit appears only when a developer sets the variable for local runs in parallel worktrees, as the PR's manual check did. The PR description says the proofs "read their root from" the export, which is accurate. Setting the variable in CI would not isolate Postgres (see `system-design-review.md` D01).

Suggestion: no CI change. Do not make the proofs set a private root until the Postgres instance names are scoped to the root.

### F06 — The timing-sensitive crash-supervision test is out of scope here (informational)

`packages/1-prisma-cloud/0-lowering/dev-emulators/src/__tests__/compute-deployment.test.ts` lines 219–253 ("held after 5 consecutive fast crashes").

Issue: the test allows 20 s for the service to reach `held`. The backoff alone takes 1 + 2 + 4 + 8 = 15 s (`BASE_BACKOFF_MS * 2 ** n`, `MAX_CONSECUTIVE_FAST_EXITS = 5`), which leaves 5 s for five bun cold starts and crashes. Under turbo load that margin is thin, which is a likely cause of the one failure the implementer saw. The neighbouring test (lines 189–217) is titled "restarts after the pinned 1s·2ⁿ delay", but it only checks for the `restarting in 1s` line. That line is written before the restart, so the test never sees a restart. Neither test is touched by this PR. Changing them here would mix an unrelated flake fix into a reviewed change.

Suggestion: leave it out of this PR. Track it separately: raise the budget to about 30 s, or make the backoff base configurable for tests, and assert a second spawn in the 1 s test.

## Deferred

- Scope `@prisma/dev` instance names to the registry root when the variable is set (D01 in the design review).
- The crash-supervision timing and the 1 s restart assertion (F06).
- An exported `EMULATORS_DIR_ENV` constant (D03).

## Acceptance criteria (the PR's own claims)

| Claim | Status | Evidence |
| --- | --- | --- |
| The retry test exercises the retry | PASS | Probe log shows a bind failure on 4307, then listening on 4308. The assertion `resultPort > takenPort` cannot pass without a retry. |
| The log-line race is closed | PASS | `awaitListeningLines` waits up to 5 s for the first line, then for the count to settle. 21/21 and 72/72 pass. The margin note is in F01. |
| `PRISMA_COMPOSER_EMULATORS_DIR` is honoured | PASS | Unit tests for unset and absolute values. A daemon started without `registryRoot` registers its log under the named directory. The env inheritance into the alchemy child was confirmed by reading the code. |
| A relative value is refused with `DEV.EMULATORS_DIR_INVALID` | PASS | The unit test checks the code and message, and the assertion is not vacuous. Surfacing in the CLI was confirmed only by reading the code (F04). |
| The integration proofs use the variable | WEAK | They read the root through `emulatorRegistryRoot()`, but nothing sets the variable in CI, and I did not run the proofs (F05). |
| The docs are updated | WEAK | The guide, the skill and ADR-0044 are updated. The Postgres caveat understates the risk (D01), and `local-dev.md` is not amended (D02). |

Counts: PASS 4, WEAK 2, FAIL 0, NOT VERIFIED 0.

## Verdict

Ready to merge once the guide and skill wording on Postgres sharing is fixed (D01). F01–F05 are small and optional for this PR. F06 belongs in its own change.
