# Dispatch 6 — Journeys, upgrade fragment, subsystem doc

**Slice:** [`../spec.md`](../spec.md) · **Plan entry:** [`../plan.md`](../plan.md) § Dispatch 6 · **Branch:** `tml-3475-statement-renames` · **Tier:** Opus · **Builds on:** dispatch 5

## Task

Prove the slice done conditions end to end with CLI journeys on Postgres and SQLite; add the upgrade fragment; amend the subsystem docs, the ADR sentences and the agent skill text that promise `@hint(was:)` or say renames have no statement; list the journeys in the journeys README.

## Outcome

After this dispatch the slice's done conditions in `spec.md` § Slice done conditions are each covered by a journey that fails when the behaviour is removed, a user upgrading reads what changed (non-data drops are widening and no longer ask consent; `--rename` exists), and every long-lived document that described rename hints in the contract source now describes statements on the command line and points at one section. The invariant: the journeys exercise the user's own commands against a real database, never the planner API, and assert database state, not only CLI output.

## Scope

**In**

- **Journeys** beside the existing ones: `test/integration/test/cli-journeys/rename-statements-migration.e2e.test.ts` (Postgres, `useDevDatabase`, `setupJourney` with `contractMode: 'psl'`) and `rename-statements-migration.sqlite.e2e.test.ts` (SQLite, `setupSqliteJourney` pattern). Fixtures `test/integration/test/fixtures/cli/cli-e2e-test-app/fixtures/cli-journeys/contract-rename-statements-{from,to}.prisma` registered in `pslContractFixtures` (Postgres); inline PSL constants on SQLite as the rename-table journey does. The "from" contract: a model (`Profile`) with rows, a unique field, a secondary `@@index`, a check (Postgres only, SQLite refuses checks), an RLS policy (Postgres only), and a second model with a foreign key to it. The "to" contract renames the model (`User`) and a field (`name` → `fullName`) that the unique and the index cover. Journeys, one `it` each with labelled assertions:
  - **S1 (both targets)** `migration plan --name initial` and `migrate` on "from"; seed rows; swap to "to"; `migration plan --name tidy-users --from <dir> --rename Profile:User --rename Profile.name:User.fullName --json` (note: the field statement names the old field through the destination model, so `--rename User.name:User.fullName`; use that form and cover the wrong form once in S3) → `ok`, operations are rename calls and companions with class `widening` and no drop/create of the table or column, `appliedStatements` has two entries in order; `migrate`; assert rows present under the new names, constraints, indexes (destination wire names), policy and check under the new names, old table absent (Postgres `to_regclass`/`pg_constraint`/`pg_indexes`/`pg_policies`; SQLite `sqlite_master` and `pragma_table_info`); a further `migration plan --from <dir> --json` is `noOp`; `db verify --schema-only` exit 0; re-run the written `migration.ts` (the `selfEmitMigration` helper) and assert `ops.json` and `migration.json` are byte-identical to the first emission.
  - **S2 (both targets)** `db update` on "from" (creates; advances the `db` ref and stores the snapshot); seed rows; swap to "to"; `db update --rename Profile:User --rename User.name:User.fullName --json` with no `--confirm` and no prompt → exit 0, `ok`, `appliedStatements` two entries, same database state as S1 (same assertions); `db verify --schema-only` exit 0; run the same `db update --rename ... --json` again → exit code of a structured error, `engineError(result).code === 'MIGRATION.STATEMENT_UNRESOLVED'`, and the message names `Profile` as not in the origin.
  - **S3 (Postgres only, cheap)** error paths through the CLI: `migration plan --rename Profile:Nope` → `MIGRATION.STATEMENT_UNRESOLVED`, no new migration directory; `migration plan --rename Profile.name:User.fullName` (old model named on the field side) → `MIGRATION.STATEMENT_INVALID` whose message contains the corrected statement; `db update --db <url> --rename Profile:User` against a database whose marker hash has no snapshot (use a fresh migrations dir or delete `migrations/snapshots/<hex>`) → `MIGRATION.STATEMENT_ORIGIN_UNKNOWN` naming the hash and the directory.
  - Add rows for both files to the "Happy paths" table in `test/integration/test/cli-journeys/README.md`.
- **Upgrade fragment** at `upgrade-instructions/pending/migration-statement-renames/`: `app/instructions.md` with one change entry for the widening reclassification (`db update` no longer asks consent, and `migration plan`'s baseline consent no longer counts, for drops of indexes, unique and foreign-key constraints, checks, RLS policies, defaults and native enum types, and for disabling RLS; a script that passed `--confirm` only for those now runs without it; detection: `--confirm` in shell/yaml/json files, glob and matches as the existing fragments do) and a second entry announcing `--rename old:new` on both commands (additive; no detection needed beyond a note; keep the summary to the user-facing behaviour); `extension/instructions.md` with one change entry: the migration planner interface's `plan` options gained a required `statements` and its success result a required `appliedStatements`, and `MigrationPlannerConflict` an optional `statement`; an extension that implements a planner adds both fields (detection glob `**/*.{ts,mts,cts}` matching `implements MigrationPlanner` or `kind: 'success'` near `plan` — pick the regexes that match the real shape). Validate by execution per `skills-contrib/record-upgrade-instructions/SKILL.md` § per-PR validation as far as it applies (the app change is behavioural, so the execution check is that `examples/*/test/**` on the branch differs from the base only in the one `handover.test.ts` expectation). Run `pnpm check:upgrade-coverage --mode pr --prev $(git rev-parse origin/tml-3474-migration-statements) --head HEAD` (stacked PR: the base is the shaping branch, F36).
- **Docs**:
  - `docs/architecture docs/subsystems/7. Migration System.md`: a new `### Statements` subsection under `## Planner` (after `### migration plan`) describing: statements as the planner's third input beside the destination contract and the origin schema; the grammar (`--rename old:new`, the four coordinate forms); resolution in the framework against the origin and destination contracts into domain coordinates; application in order to a working copy of the origin schema; the family's storage effect per statement (table rename plus companions, column rename plus companions, zero operations when storage is unchanged or the field is a relation); `appliedStatements` on the planner result; the three error codes and `statementRejected`; `db update`'s origin contract from the marker hash through the snapshot store (and that `--db <url>` without `--advance-ref` leaves no snapshot, so renames need `--advance-ref` there); what this slice does not do (`--delete`, the refusal, namespace moves, Mongo) with a pointer to the project's next slices by name only (no `projects/` paths). Replace the `@hint(was:)` sentences at the `### Offline planning via contract-to-schema` lines (around 139 and 143) with one sentence pointing at § Statements; in `### db update (live reconciliation)` (around 740–746) say the origin contract comes from the marker's snapshot when statements are given.
  - `docs/architecture docs/subsystems/1. Data Contract.md`: rewrite `### Canonical contract vs planner hints` (around 76–82) to say intent is stated on the command line as statements, is never part of the contract or its hashes, and point at the Migration System doc § Statements; fix the sentence around line 329 ("require explicit planner hints") the same way.
  - ADR 001 (lines around 32, 54, 87, 143, 155), ADR 028 (54, 130–135, 295) and ADR 264 (76–77): do not rewrite history; add one short amendment note under each affected sentence or at the top of the ADR ("Amended 2026-10: intent is stated as command-line statements, see Migration System § Statements; the close-out ADR of the migration-statements project supersedes the hint vocabulary"), following whatever amendment convention other ADRs in the folder use (grep `Amended` / `Superseded`).
  - `skills/prisma-8/references/migrations.md` (pitfall 8 around 497, "doesn't do yet" around 506, and the `renameTable` line around 361 gains `renameColumn`), `skills/prisma-8/references/contract.md` (around 430, 434, 457, 461) and `skills/journey-tests/02b-rename-with-hint.md`: say that `migration plan --rename old:new` and `db update --rename old:new` state a model or field rename, that the planner then renames instead of dropping, and keep the hand-edit route as the fallback for cases statements do not cover. Keep each edit to the sentences that are now wrong.
  - `docs/reference/error-reference.md`: re-read the four entries (`STATEMENT_*`, `PLANNING_FAILED`, `COLUMN_RENAME_UNMATCHED`) against the final CLI behaviour.
  - `pnpm lint:docs` or whatever the repo's doc link check is (see `package.json` scripts) passes; no new `projects/` references in long-lived files (`git grep -n "projects/migration-statements" -- docs skills packages upgrade-instructions test` prints nothing).

**Out**

- Any production code change beyond what a journey proves broken; if a journey finds a defect, fix it in its own commit and say so, or halt if the fix is larger than a few lines.
- The close-out ADR, ADR 001/028 rewrites, migrating the project folder (project close-out).
- Mongo journeys (slice 4).

## Where things are

- Harness: `test/integration/test/utils/journey-test-helpers.ts` (`setupJourney`, `swapPslContract`, `pslContractFixtures`, `runContractEmit`, `planMigrationAndSelfEmit`, `selfEmitMigration`, `runMigrate`, `runDbVerify`, `runDbUpdate`, `runMigrationPlan`, `latestMigrationDirName`, `engineError`, `parseJsonOutput`, `sql`, `consentTokenFor`, `timeouts`); `useDevDatabase` from `@repo/test-utils`; the SQLite pattern in `rename-table-migration.sqlite.e2e.test.ts` (`setupSqliteJourney`, `withDatabase`, `node:sqlite`).
- Existing journeys to copy from: `rename-table-migration.e2e.test.ts` (R1, R5), `rename-table-migration.sqlite.e2e.test.ts` (R3, R4 with `db update`), `db-update-workflows.e2e.test.ts` (consent and `--json` shapes).
- Snapshot store: `<migrations>/snapshots/<storageHashHex>/`; refs at `<migrations>/app/refs/db.json`; `db update` writes both unless `--db <url>` without `--advance-ref`; `migration plan` writes the destination snapshot after the package.
- Upgrade fragments: `upgrade-instructions/pending/<name>/{app,extension}/instructions.md`, examples `prisma7-migration-handover/app`, `rename-constraint-call/extension`, no-op `binder-from-caller/extension`; checker `scripts/check-upgrade-coverage.mjs`; lifecycle `upgrade-instructions/README.md`.
- Run journeys one file at a time: `mise exec -- pnpm --filter integration-tests exec vitest run --config vitest.journeys.config.ts test/cli-journeys/rename-statements-migration.e2e.test.ts` (check the exact script in `test/integration/package.json`). Build first (`mise exec -- pnpm build`): journeys run the CLI from `dist` (F31).

## Edge cases and dispositions

| Case | Disposition |
| --- | --- |
| Journey label text for operations differs per target (Postgres quotes names, SQLite does not) | Assert per target, as the rename-table journeys do. |
| SQLite refuses checks and has no RLS | Omit from the SQLite fixture; assert indexes and the FK instead. |
| Byte-identical re-emit | Compare file contents, not parsed JSON. |
| `db update` second run | Relies on the first run having stored the snapshot (no `--db`, so the `db` ref advanced). Assert the snapshot directory exists before the second run so a harness change shows up as the right failure. |
| A journey fails on behaviour the planner tests pass | Rebuild `dist` first (F31); then treat as a real defect and report. |
| Destructive git | Forbidden, as in every brief; no `git checkout -- <file>`. |
| F14, F24, F36 | As in every brief; the upgrade check runs against the shaping branch as base. |

## Validation gate

Through `mise exec --`, filters quoted one per `--filter`, long output to `wip/`.

- `pnpm build`, then the two new journey files one at a time (they are the only journeys to run; never `pnpm test:journeys` or `test:integration` in full).
- `pnpm typecheck`
- `pnpm --filter integration-tests lint`
- `pnpm check:upgrade-coverage --mode pr --prev $(git rev-parse origin/tml-3474-migration-statements) --head HEAD`
- `pnpm check:error-reference`, `pnpm lint:deps`, `pnpm lint:framework-vocabulary` (272), `pnpm fixtures:check`
- The repo's docs link check if one exists in `package.json` scripts.

## Completed when

- Every slice done condition in `spec.md` has a named assertion in a journey, on both targets where the condition applies, and the two journey files pass locally.
- The upgrade fragment exists for both audiences and the coverage check passes against the shaping branch as base.
- No long-lived file promises `@hint(was:)` as the way to state a rename; `git grep -n 'hint(was' -- docs skills packages` returns only amendment notes or ADR history.
- No `projects/` references in long-lived files.
- Small signed `TML-3475:` commits; no attribution lines; no push.

## Operational

- Heartbeats to `wip/heartbeats/implementer.txt`. Time-box about three hours; journeys are slow, so run each file once per change. Halt and report when a journey exposes a defect larger than a few lines, or when the `db update` second run cannot find the origin for a reason other than a missing snapshot.
- Stay inside the worktree.

## Return shape

As in the earlier dispatches, plus: for each slice done condition, the journey and assertion label that covers it.
