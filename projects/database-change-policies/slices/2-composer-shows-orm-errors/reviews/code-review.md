# Code review: deploy shows Prisma ORM's own migrate errors

Branch `tml-3726-show-orm-migrate-errors` against `origin/main` (merge base range `origin/main...HEAD`, 4 commits: `947ba149`, `4f9e49eb`, `0e943404`, `94c67b15`). Expectations come from the untracked slice spec `wip-slice-spec.md` and the Linear intent for TML-3726. Prisma ORM behaviour was read from the ORM source at tag `v8.0.0-rc.24`, the version Composer pins.

## Summary

The change does what the spec says for every failure that `migrate` returns: the deploy now shows the ORM's code, summary, why, next actions and docs link, written the way the `prisma` CLI writes them, and every new test can fail. Two correctness gaps remain: failures that `migrate` throws instead of returning are still retried for about a minute and lose their advice, and the printed re-run command drops the `--to <ref>` a pinned deploy used, so following it would migrate past the pinned ref.

## What looks solid

- The `--db <url>` in the advice is a literal placeholder. At rc.24 `cliCommand` in `packages/1-framework/3-tooling/cli/src/utils/printed-command.ts` appends the fixed words `--db` and `<url>` when `dbGiven` is true, and its doc says the URL stays a placeholder because it can hold credentials. The integration tests compare whole messages while connected to a real database URL, so any leak of the URL would fail them.
- Nothing else in the message can carry the connection string. The message uses only `code`, `message`, `why`, `nextActions`, `fix` and `docsUrl`; `meta` is not written. The runner failure's `why` is the Postgres error text (for example `division by zero`), which does not contain the URL. The converge text still passes through Composer's secret redaction before it reaches `--report` and the platform's `errorMessage`.
- The rendering matches the CLI engine's `writeDiagnostic` and `renderNextAction` in `@prisma/cli-engine` 0.10.0 line for line: the `[CODE] summary` head, the `  why:` line with continuation lines indented by seven spaces, `→ label: command`, a label printed once when the command equals it, and `  docs:`.
- `printedConfigPath` uses `pathe`'s `relative`, so it prints forward slashes on Windows too, and a relative `config` such as `./prisma.config.ts` resolves against the same working directory the deploy sets for the converge (`execute-deploy-destroy.ts` sets the process's working directory while Alchemy runs). The ORM shell-quotes the `--config` value.
- The type of `code` is honest: `OrmMigrationFailureCode | OrmMigrateFailure['code']`, where the second is the ORM's `` `${string}.${string}` ``. The only code matchers in the repo are tests, and none still expects `MIGRATION_PATH_NOT_FOUND` or `RUNNER_FAILED`.
- The integration tests assert the whole message for each of the three cases the spec shows, plus the never-planned case, against a real Postgres.
- The cap test pins both sides of the 4000-character boundary.

## Findings

### F01: failures `migrate` throws are retried for about a minute and lose the ORM's advice

- **Location:** `packages/1-prisma-cloud/1-extensions/target/src/orm-migrate.ts` — lines 256–273 (`applyOrmMigration`) and 312–329 (`runMigration`).
- **Issue:** At rc.24 `executeMigrate` (`packages/1-framework/3-tooling/cli/src/control-api/operations/migrate.ts`) returns most failures, but throws some of them as `CliStructuredError`: `MIGRATION.NO_INVARIANT_PATH` (line 229, a `targetRef` whose required invariants no migration path provides), the contract-space load and integrity failures for extension packs (line 169, for example the `Contract-space contract validation failed for "auth"` that the auth pack's README describes), and in `client.migrate` itself `CONTRACT.VALIDATION_FAILED` and `MIGRATION.TARGET_UNSUPPORTED`. None of these is an `OrmMigrationError`, so `withConnectionRetry` retries each of them 12 times, 5 seconds apart, and then the deploy fails with the ORM's summary only: the `why` and the next actions that this slice exists to show are lost. The spec records leaving thrown errors alone on the grounds that they "can include driver connection failures". Those are distinguishable: the ORM's driver failures carry `DRIVER.*` codes (`DRIVER.CONNECTION_FAILED`, `DRIVER.NOT_CONNECTED`) or are plain `pg` errors with no dotted code, while the cases above carry `MIGRATION.*` and `CONTRACT.*` codes. This behaviour exists on `main` too, but the intent of this slice is that a failed migrate shows the ORM's error and is never retried as a connection error, and a pinned `targetRef` with a misspelled invariant reaches it.
- **Suggestion:** In `runMigration`, catch what `client.migrate` throws; when it is a structured error (`CliStructuredError.is` from `@internal/foundation`, or the ORM's own check) whose code does not start with `DRIVER.`, throw `new OrmMigrationError(error)`, and rethrow everything else unchanged so connection failures keep being retried. Widen the constructor's parameter from the `migrate` result's failure type to the structured-error shape it reads. Add an integration test: a ref that requires an invariant no migration provides, asserting the whole `MIGRATION.NO_INVARIANT_PATH` message and that the call rejects with `OrmMigrationError`.

### F02: the printed re-run command drops `--to <ref>` for a deploy pinned to a ref

- **Location:** `packages/1-prisma-cloud/1-extensions/target/src/orm-migrate.ts` — lines 316–326.
- **Issue:** The ORM builds its re-run advice from `invocation.rerunArgs` (`runner-failure-advice.ts` at rc.24, lines 308, 585 and 608: `cliCommand(invocation, 'db migrate', invocation.rerunArgs ?? [])`, and the same for `db update` at lines 109 and 282). The ORM's own `db migrate` passes `['--to', <ref>]` there (`orm/migrate.ts` line 500). Composer passes no `rerunArgs`, so when a database resource sets `targetRef`, a migration that fails while it applies prints ``re-run `prisma db migrate --db <url>` ``. Run as printed, that command migrates the database to the head of the graph, past the ref the deploy pinned, which is the one thing a pinned ref exists to prevent.
- **Suggestion:** Pass `rerunArgs: refName === undefined ? [] : ['--to', refName]` in the invocation. Ref names need no shell quoting: the ORM accepts only lower-case letters, digits, `-` and `/` (`REF_NAME_PATTERN` in `migration/src/refs.ts` at rc.24). Add an integration test that runs the failing baseline fixture with a named ref and asserts the whole message, including `prisma db migrate --to <ref> --db <url>`.

### F03: nothing tests that the resource passes its `prisma.config.ts` to the migration

- **Location:** `packages/1-prisma-cloud/1-extensions/target/src/orm-migration-resource.ts` — line 131; tests in `packages/1-prisma-cloud/1-extensions/target/src/__tests__/orm-migration-resource.test.ts`.
- **Issue:** Deleting `configPath: news.configPath` from the resource's call to `applyOrmMigration` leaves every test green (mutation `config-not-passed` below). The `--config` tests call `applyOrmMigration` directly, so the deploy path that users hit is not covered: a regression would silently print recovery commands that run against the wrong config.
- **Suggestion:** Add a resource-level test whose `configPath` is in a subdirectory and whose database's marker is not in the migration graph (the `MIGRATION.MARKER_MISMATCH` case, because the ORM's no-path advice does not print `--config`), and assert the `--config <relative path>` lines.

### F04: two small differences from what `prisma db migrate` prints, though the spec says they read the same

- **Location:** `packages/1-prisma-cloud/1-extensions/target/src/orm-migrate.ts` — lines 101–120 (`migrateFailureText`).
- **Issue:** (1) The ORM CLI turns a `fix` into one next action per non-empty line (`actionsFromFix` in `orm/normalize-error.ts` at rc.24). Composer writes the whole `fix` after one arrow, so a multi-line `fix` prints its second and later lines with no arrow and no indent. (2) The CLI engine fills in a docs link for every ORM code from the ORM family's `docsBaseUrl` (`withDocsUrl` in the engine; `DOCS_BASE_URL` in `orm/family.ts`), so `prisma db migrate` prints a `docs:` line for `MIGRATION.MARKER_MISMATCH` and `MIGRATION.PATH_UNREACHABLE`; the deploy prints none for them. The spec's claim that "a user reads the same advice from `prisma db migrate` and from `prisma deploy`" is therefore not quite true.
- **Suggestion:** Split `fix` into lines, trim them, drop empty ones, and write one `→` line each, with a unit test for a two-line `fix`. For the docs link, do not copy the ORM's base URL into Composer (that would be one value kept in step in two repos); instead correct the spec and the PR text to say the deploy shows a docs link only when the ORM's error carries one.

### F05: text that still describes the removed refusal

- **Location:**
  - `docs/design/10-domains/local-dev.md` — line 497: "hits the same structured refusal a deploy would, naming both exits (`prisma db update` to iterate, `contract emit` + `migration plan` to author the path)".
  - `packages/1-prisma-cloud/1-extensions/target/src/orm-migration-resource.ts` — lines 135–136: "Surface OrmMigrationError (no-path / runner) as-is".
  - `packages/1-prisma-cloud/1-extensions/target/src/__tests__/orm-migrate.integration.test.ts` — line 102: the describe name "no authored graph (structured refusal)".
- **Issue:** The refusal with "both exits" no longer exists; `dev` now shows the ORM's error and its advice, which depends on the case. The comment and the test name name failure kinds that no longer exist as codes.
- **Suggestion:** Rewrite the local-dev sentence to say a `dev` run against such a database fails with the same Prisma ORM error a deploy shows. Shorten the resource comment to what the code cannot say, or delete it. Rename the describe to "no authored graph".

### F06: wording in the guide and the skill

- **Location:** `docs/guides/building-an-app.md` — lines 222–232; `skills/prisma-composer-core-concepts/SKILL.md` — line 364.
- **Issue:** "`prisma db update` for a database that does not change only through migrations" is a double negative that has to be read twice. The new example block in the guide is fenced with no language, where the guide's other output blocks use `text`.
- **Suggestion:** Write it positively, for example: "`prisma db update` for a development database that you also change outside migrations; for a database that changes only through migrations, such as production, author the migrations instead." Use the same words in the skill. Fence the example as `text`.

### F07: comments the review calibration asks to cut

- **Location:** `packages/1-prisma-cloud/1-extensions/target/src/__tests__/orm-migrate-failure.test.ts` — lines 1–7; `packages/1-prisma-cloud/1-extensions/target/src/orm-migrate.ts` — line 275 (doc comment on `printedConfigPath`) and line 100 (doc comment on `migrateFailureText`).
- **Issue:** The test file's seven-line header explains what the file and another file do; the describe and test names already say it. The doc comments on the private `printedConfigPath` and `migrateFailureText` restate the code. The calibration file asks to delete doc comments on code that is not a user-facing interface and comments longer than two lines.
- **Suggestion:** Delete the test header and the two doc comments. Keep the comment on `withBinaryName` (why `prisma` is the name) and the two added lines in `runMigration` (why `dbGiven` is true), which the code cannot express.

## Deferred (out of scope)

- **The ORM's no-path advice ignores the invocation.** At rc.24 `errorPathUnreachable` builds `Plan the missing edge` and `Apply it: prisma db migrate --to <hash>` without the invocation, so a deploy prints neither `--config` nor `--db <url>` there; run as printed from a module app, that command would use the working directory's `prisma.config.ts` and its database. Out of scope because the fix is in Prisma ORM; it needs an ORM ticket.
- **The converge `reasons` in `meta` are not capped.** `execute-deploy-destroy.ts` caps `engineCause` but copies each reason's message uncapped into `meta.reasons`. This was already so before the branch and the branch does not change what reaches `reasons`.
- **`CONTRACT_INVALID` has no test.** Unchanged by this branch.
- **One error class with two message formats.** Composer's own failures still read `Prisma ORM migrate (CONTRACT_IDENTITY_MISMATCH): …` while the ORM's read `[MIGRATION.…] …`. This is a naming and shape question for the system-design pass, not a correctness defect.

## Already addressed

None; this is the first review round.

## Other checks

- **The cause cap.** `capFailureCause` output is the `DEPLOY.ENGINE_FAILED` summary's second part and `meta.engineCause`. The platform reporter truncates `errorMessage` to 5000 characters (`execute-deploy-destroy.ts` line 294), and the summary line in front is 34 characters, so a 4000-character cause fits. No other consumer applies a smaller limit. The new test fails if the limit is 1000 or 4001.
- **The `{bin}` replacement.** Composer replaces `{bin}` in the summary, why, next actions, fix and docs URL; the engine replaces it in the summary, why and next actions. Replacing it in two more fields is harmless.
- **The lint error the implementer reported.** It is not a lint finding. The implementer's log shows `biome check . -- --max-diagnostics=300 --diagnostic-level=error`: the flags after `--` were read as file paths and Biome reported an internal "No such file or directory" error for them. `pnpm lint` on the branch exits 0 with no errors.
- **The auth pack README** (`packages/1-prisma-cloud/2-shared-modules/auth/README.md`, line 228) still names `MIGRATION_PATH_NOT_FOUND`, but in an upgrade section for Composer 0.34.0, where that is the code users saw; left as is.

## Acceptance-criteria verification

The spec has no numbered criteria; these are taken from its Outcome and Design sections and from the ticket's intent.

| AC | Verdict | Detail |
| --- | --- | --- |
| AC1: a failed migrate's `code` is the ORM's code; `MIGRATION_PATH_NOT_FOUND`, `RUNNER_FAILED` and `noPathRefusal` are gone | **PASS** | `OrmMigrationFailureCode` no longer lists them and `git grep` finds no use outside history in ADR-0022's context section. Integration tests assert `MIGRATION.PATH_UNREACHABLE`, `MIGRATION.MARKER_MISMATCH`, `MIGRATION.EXECUTION_FAILED`; the resource test asserts `MIGRATION.PATH_UNREACHABLE`. Mutation `code-old` fails. |
| AC2: the message is the ORM's envelope in the CLI's format (code and summary, why, next actions or fix, docs) for the marker, no-path and execution cases | **PASS** | Whole-message `toBe` assertions in `orm-migrate.integration.test.ts` for all three cases plus the never-planned case, against real ORM output; unit tests pin each format rule. Mutations `why-indent`, `no-docs`, `label-twice`, `fix-first` all fail. Small divergences from the CLI are in F04. |
| AC3: Composer's own codes stay | **PASS** | `CONTRACT_ARTIFACT_UNREADABLE`, `CONTRACT_IDENTITY_MISMATCH` and `TARGET_REF_NOT_FOUND` are asserted by existing tests; `CONTRACT_INVALID` is unchanged and untested (deferred). |
| AC4: a failed migrate throws `OrmMigrationError`, which the retry never retries | **WEAK** | True for failures `migrate` returns: the code throws `OrmMigrationError` and the predicate excludes it. The only evidence it is not retried is indirect: mutation `retry-all` makes four integration tests time out at 5 seconds; no test asserts "rejects at once" or counts attempts. |
| AC5: failures `migrate` throws are shown and not retried as connection errors (ticket intent) | **FAIL** | They are retried 12 times and lose their advice; see F01. The spec chose to leave them, for a reason that does not hold (F01). |
| AC6: `{bin}` becomes `prisma` | **PASS** | Unit and integration tests assert `prisma …` in whole messages; mutation `no-bin` fails four tests. |
| AC7: advice carries `--db <url>`, as a placeholder, never the real URL | **PASS** | Placeholder established from the ORM source at rc.24; whole-message assertions run with a real URL connected; mutation `dbgiven-false` fails four tests. |
| AC8: `--config` is the resource's config relative to the working directory, and left out for `prisma.config.ts` there | **WEAK** | `applyOrmMigration` is tested both ways (mutations `config-absolute` and `config-always` fail), but nothing tests that the resource passes its config: mutation `config-not-passed` survives (F03). |
| AC9: the re-run advice is correct for the deploy that failed | **FAIL** | With `targetRef` set, the re-run command drops `--to <ref>` (F02). No test covers a pinned ref failing. |
| AC10: the cause cap is 4000 characters | **PASS** | Boundary test at 4000 and 4001; mutations `cap-1000` and `cap-4001` fail. Downstream 5000-character limit checked. |
| AC11: the guides, the skill and the ADR match the code | **WEAK** | The guide, skill and ADR-0022 describe the new behaviour correctly, but `docs/design/10-domains/local-dev.md` still describes the removed refusal (F05), and the wording needs work (F06). |

### Summary

| Result | Count | ACs |
| --- | --- | --- |
| PASS | 6 | AC1, AC2, AC3, AC6, AC7, AC10 |
| FAIL | 2 | AC5, AC9 |
| NOT VERIFIED | 0 | |
| WEAK | 3 | AC4, AC8, AC11 |

## What was run

All output is saved under `wip-logs/review-*` at the clone root.

| Command | Result |
| --- | --- |
| `pnpm lint` | exit 0; 0 errors, 41 warnings, 15 infos (`review-lint.log`) |
| `pnpm lint:casts`, `lint:control-bytes`, `lint:retired-binary-name`, `lint:deps` | all exit 0; casts delta 0 |
| `pnpm typecheck` in `@internal/prisma-cloud` and `@internal/cli` | both exit 0 |
| `pnpm test` in `@internal/prisma-cloud` | 722 pass, 0 fail (Postgres from local `initdb`; no credentials) |
| `pnpm test` in `@internal/cli` | 545 pass, 1 skip, 0 fail |
| `bun test` on the four ORM migrate test files | 31 pass, 0 fail; integration tests ran, not skipped |
| `pnpm test` in `website` | 9 pass |

## Mutations

Each mutation was applied with `wip-logs/review-mutate.sh`, the named tests were run, and the file was restored with `git checkout`. The tree is clean apart from the untracked `wip-*` folders.

| Mutation | Change | Result |
| --- | --- | --- |
| `cap-1000` | cause limit 4000 → 1000 | 1 test fails |
| `cap-4001` | cause limit 4000 → 4001 | 1 test fails |
| `no-bin` | `{bin}` left as is | 4 tests fail |
| `fix-first` | write `fix` instead of next actions | 2 tests fail |
| `why-indent` | wrong continuation indent | 1 test fails |
| `no-docs` | docs line without indent | 1 test fails |
| `label-twice` | always print `label: command` | 1 test fails |
| `code-old` | `code` set to `RUNNER_FAILED` | 1 test fails |
| `why-dropped` | `why` not kept | 1 test fails |
| `dbgiven-false` | `dbGiven: false` | 4 tests fail |
| `config-absolute` | `--config` not made relative | 2 tests fail |
| `config-always` | `--config` printed for `prisma.config.ts` in the working directory | 1 test fails |
| `config-not-passed` | resource stops passing `configPath` | **survives** (F03) |
| `retry-all` | retry every error, including `OrmMigrationError` | 7 tests fail, by timing out (AC4) |
