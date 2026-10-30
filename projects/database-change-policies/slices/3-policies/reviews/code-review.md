# Code review — slice 3: refs declare policies, the marker records them, the change policy is enforced

Branch `tml-3727-policies`. Round 1 reviewed `origin/main...HEAD` before the rebase. Round 2 reviews the rebased branch at `4d471ece22`, against the decisions in [`../spec.md`](../spec.md) § *Decisions after the first review*. Reviewer persona: principal engineer.

## Summary

Round 2: eight of the ten round-1 findings are fixed and two are partly fixed. The fixes cover the separate marker and ledger decisions in every runner, the policy comparison under the lock, the Postgres `jsonb_set` merge, the result-returning parser, `NamedRef`/`targetHash`, re-run advice and `db migrate --show`.

What remains:

- **F05, partly fixed.** A corrupt `meta.policies` is now `CONTRACT.MARKER_ROW_CORRUPT`. But that error's fix and next action still say to delete the marker row and run `db sign`. On a migrations-only database, following that advice drops the policy.
- **F08, partly fixed.** The shared failed-run journey only checks that the run failed, so a refusal before any migration would also pass it.
- **F11, new.** On MySQL and MongoDB, extension spaces are applied before the application space's runner compares the policies. A refusal caused by a concurrent policy change therefore comes after extension DDL has committed.
- **F12, new.** A conflict caused by moved policies is reported as if the storage hash moved. `db sign` says the marker changed "from X to X", and the error reference does not mention this cause.

Verified this round by running these test files:

- **CLI, 11 files (83 tests):** `wip/review2-cli.txt`.
- **Framework policies:** `wip/review2-fw.txt`.
- **Postgres adapter, marker and runner:** `wip/review2-pg-adapter.txt`.
- **SQLite runner and marker:** `wip/review2-sqlite.txt`.
- **MongoDB runner and adapter:** `wip/review2-mongo-runner.txt`, `wip/review2-mongo-adapter.txt`.
- **Integration file `cli.database-policies.migrate.e2e.test.ts`** on PostgreSQL and SQLite (24 tests): `wip/review2-e2e-migrate.txt`.

All pass. The MySQL and MongoDB integration files were not run locally.

## What looks solid

- **Runner marker and ledger decisions are separate on all four targets.** Postgres and SQLite write the marker when the self-edge skip fails or policies are given. They then skip the ledger when the run only records policies: no operation, marker already at its destination, no new invariant (`postgres/1-target/.../runner.ts` 252–272, `sqlite/1-target/.../runner.ts` 171–187). MySQL passes `undefined` operations to `#writeMarkerAndLedger` in the same case (`mysql/1-target/.../runner.ts` 224–242). MongoDB gates the ledger on `!isNoOp` alone (`mongo-runner.ts` 408–474). An in-sync `db update` without the flag still writes its row, as decided.
- **Policies are compared under the lock.** Postgres and SQLite compare after `acquireLock` and `readMarker`, before any operation. MySQL compares inside `withMarkerLock`, after `#checkOrigin`. MongoDB compares at the start and adds `meta.policies` (or its absence) to the compare-and-swap filter. `db sign` compares inside the SQL family's lock and transaction (`control-instance.ts` 603–612, 661–671) and in Mongo's compare-and-swap filter. Each runner has a "policies moved after the caller checked them" test.
- **Postgres `jsonb_set(coalesce(marker.meta, '{}'), '{policies}', $1)`** merges in the statement. The integration test shows another `meta` key survives. MySQL's `JSON_SET` upsert and its `SELECT … FOR UPDATE` swap now use the framework's key and serialiser.
- **`databasePoliciesOf` returns a `Result`.** The CLI raises `CONTRACT.MARKER_ROW_CORRUPT` once, in `databasePoliciesInForce`, with `meta.space`. `change` requires at least one strategy, in the ref and in the marker. Each value list is a constant that both the types and the schema derive from, and a type test ties the schema to the interface.
- **The order of checks is off-graph, then policy comparison, then change policy.** It holds in the control API's `migrate` (`migrate.ts` 170–201), in the CLI (which now only runs `planEverySpace` before calling the client) and in `--show`. A unit test asserts `MARKER_MISMATCH` wins over a mismatching ref.
- **`NamedRef` with a required name; `targetHash` for a hash, `@db` or `@empty`.** `dbUpdate` throws an internal error when `ref.hash` is not the contract it reconciles to, and a test covers it.
- **`--permit-policy-change` is repeated in `rerunArgs` only when given** (`orm/migrate.ts`, `orm/db/update.ts`). No refusal mentions it.

## Findings

### Round 1, still open

#### F05 — Partly fixed: `MARKER_ROW_CORRUPT` advises deleting the marker row, which drops the policy

Paths: `packages/1-framework/1-core/errors/src/execution.ts` 71–95; `packages/1-framework/3-tooling/cli/src/control-api/operations/database-policies.ts` 25–35; `docs/reference/error-reference.md` 500–502.

Fixed: the code is `CONTRACT.MARKER_ROW_CORRUPT`, raised once from the parser's result, and the reference entry says correcting or removing `meta.policies` keeps the rest of the row.

Not fixed: the CLI calls the existing `errorMarkerRowCorrupt`. Its fix says "Delete the row, then run `{bin} db sign --db <url>` to write a fresh marker", and its only next action is that `db sign` command. Follow it on a production database whose `meta.policies` is mistyped:

1. The marker row is deleted.
2. `db sign` finds no marker, which counts as adoption and is never refused.
3. It writes a marker with no policies, so the database now permits `db update`.

The invariants the row recorded are lost too. The error's own advice contradicts the reference entry written for this case.

Suggestion: give the policies case its own builder, or a `fix` and `nextActions` override, that keeps the row:

```ts
errorMarkerRowCorrupt({ why, space: appSpaceId, markerLocation, fix: `Correct meta.policies in the ${markerLocation} row for space "${appSpaceId}", or remove the policies key to restore the default policies. Do not delete the row: it records the database's contract and invariants.` });
```

Make the next action a `user-choice` with that text. Assert the whole envelope in `migrate-database-policies.test.ts`; it currently asserts only `code` and `meta.space`.

#### F08 — Partly fixed: the shared failed-run journey passes on any failure

Paths: `test/integration/test/utils/database-policies-migrate.ts` 153–178.

Fixed: the journey runs on all four targets. The MongoDB-specific test now asserts that the first migration stayed applied (`name` is in the collection validator) and that a retry with the flag records the policies.

Not fixed: the shared test calls `errorOf(failed)`, which checks only that the exit code is non-zero, then asserts the marker is unchanged. A run refused before any migration, for example by a regression that raised `CHANGE_POLICY_FORBIDS` or `POLICY_MISMATCH` here, leaves the marker unchanged too. The test would then pass without exercising a failed run at all. Round 1's Postgres version asserted `meta: { failingSpace: 'app' }`; that assertion was dropped when the test moved.

Suggestion: assert the failure came from the second migration's execution, for example:

```ts
expect(errorOf(failed)).toMatchObject({ meta: { failingSpace: 'app' } });
```

Also assert one effect of the first migration (the `name` column exists) on the SQL targets. On PostgreSQL and SQLite, where the run rolls back, assert instead that the column is absent.

### Round 2

#### F11 — On MySQL and MongoDB, extension DDL commits before the application space's runner sees the moved policies

Paths: `packages/1-framework/3-tooling/cli/src/control-api/operations/run-migration.ts` 277–303; `packages/1-framework/3-tooling/migration/src/aggregate/aggregate.ts` 296–300; `packages/3-targets/mysql/1-target/src/core/migrations/runner.ts` 117–197; `packages/3-targets/mongo/1-target/src/core/migrations/mongo-runner.ts` 272–292.

`runMigration` hands `expectedDatabasePolicies` only to the application space's runner options. The apply order is extensions first, then the application space (`spacesInApplyOrder`). MySQL applies one space at a time, and each DDL statement commits as it runs; MongoDB does the same without a transaction.

Concrete failure on MySQL: `db migrate` checks the policies and reads `change: [migrate, reconcile]`. Before it takes the marker lock, a policy-only run records `change: [reconcile]`. `db migrate` then takes the lock and applies the pending extension migration, which commits its DDL. Only then does it reach the application space, and there it fails with `MIGRATION.MARKER_CAS_FAILURE`. The database is left half-moved by a command its policy no longer permits.

On Postgres and SQLite the same order is harmless, because all spaces run in one transaction that rolls back.

Suggestion: compare the policies once, before the first space. In the MySQL runner, read the application space's marker inside `withMarkerLock` before `#applySpaces`. In the MongoDB runner, do the same before the first space. Alternatively, pass `expectedDatabasePolicies` to whichever space runs first, and have that runner read the application space's marker for the comparison. Add a facade live test with an extension space pending to show no extension DDL ran.

#### F12 — A conflict caused by moved policies is reported as a moved storage hash

Paths: `packages/1-framework/3-tooling/cli/src/orm/db/sign.ts` 262–284; `packages/2-sql-family/9-family/src/core/control-instance.ts` 606–612; `packages/2-mongo-family/9-family/src/core/control-instance.ts` 230–236; `docs/reference/error-reference.md` 1725–1727.

When only the policies moved, both families return `status: 'conflict'` with `found` equal to `expected`. `db sign` then prints:

```text
Another process, such as migrate, changed the marker from 4b1c… to 4b1c… after db sign read it
```

That sentence is false as written. Its `meta` (`expectedStorageHash` equal to `foundStorageHash`) gives a reader nothing to act on.

The runners' new `MARKER_CAS_FAILURE` does say in its `why` that the policies changed. But its `meta` has the same equal hashes. The reference entry still describes the code as a hash race found "while finalizing an apply", while the policy variant is raised before any operation.

Suggestion: carry the reason in the outcome and the envelope, `reason: 'storageHash' | 'databasePolicies'`. Make `db sign`'s `why` say "changed the database's policies after db sign read them" when that is the reason. Add the policy cause and the `reason` payload to the reference entry. Add a CLI test for the `db sign` diagnostic in the policies case; `db-sign.marker-changed.test.ts` covers only hash changes.

## Deferred

| Item | Why deferred |
|---|---|
| The MongoDB runner reports a failed schema command (duplicate keys on `createIndex`) as `CLI.UNEXPECTED`. | Predates the slice; ticketed as TML-3779. |
| The marker-destination shape is still declared in several places outside the runners. | Predates the slice; the spec records it as a separate refactor. |
| When an extension space's change policy refuses a command, the advice tells the user to author a migration. | Moot now: policies live only on the application space's marker and govern every space. |
| Data protection enforcement, `migration plan --to <ref>` checks, Composer. | Slices 4 and 5. |

## Already addressed

| Finding | Resolution | Commits |
|---|---|---|
| F01 — a policy-only `db update` wrote a ledger row | Each runner decides the marker write and the ledger write separately. A run that only records policies writes no ledger row; `db update` plans from no origin, so the rule keys on "marker at destination", not on a self-edge. Runner tests on Postgres, SQLite, MySQL and MongoDB, and an integration journey asserting an unchanged ledger length. | `a1379edfa5`, `fffeb80e96`, `44a10cedda` |
| F02 — policies were checked before the runner's lock | `expectedDatabasePolicies` is compared under the lock on Postgres, SQLite and MySQL, and in MongoDB's compare-and-swap filter; `db sign` compares inside its lock (SQL) and filter (MongoDB). Tests on every runner and both families' `signSpaces`. Residuals: F11, F12. | `a1379edfa5`, `bf42cfb1e8`, `6423cd7322`, `5f68f839e0` |
| F03 — `CHANGE_POLICY_FORBIDS` said "the marker records" a ref's declaration | `checkRunPolicies` passes `source`; the `why` reads `<ref> declares change: …`. The reference says `meta.change` holds the strategies that refused the command, from either source. Unit tests for both sources. | `bf42cfb1e8`, `86e0766c01` |
| F04 — `change: []` was accepted | `atLeastLength(1)` in the framework schema, used by refs and markers; test cases in both. | `dafec47049` |
| F06 — re-run advice dropped the flag | Both `rerunArgs` repeat `--permit-policy-change` when the user gave it; unit test asserts the repeat. | `bf42cfb1e8` |
| F07 — MySQL and MongoDB lacked the `--to <ref>` journeys; refusal test could not see DDL | `definePolicyMigrateJourneys` runs on all four; the refusal test compares `db schema --json` before and after. | `44a10cedda` |
| F09 — `dbUpdate` did not check `ref` against `contract` | Internal error when `ref.hash` differs from the contract's storage hash; unit test. | `bf42cfb1e8` |
| F10 — duplicated formatting, overlay, and type/schema drift | One `databasePolicyValueText`; `withDeclaredDatabasePolicies` in the framework; value lists defined once; `database-policies.types.test-d.ts` ties schema to types. | `dafec47049`, `bf42cfb1e8` |

## Acceptance-criteria verification

Round 2 re-checks every row that was FAIL or WEAK, and adds a row for each decision in *Decisions after the first review*. The other round-1 rows stand as recorded: their code and tests were renamed, not changed in substance, and the 83 CLI tests that cover them pass.

### Rows re-checked

| # | Condition | Round 1 | Round 2 | What I checked |
|---|---|---|---|---|
| D1a | A deploy with a mismatching ref fails before any DDL, four targets | FAIL | PASS | Shared journey on all four; asserts the whole `POLICY_MISMATCH` envelope, marker, ledger length, and `db schema --json` unchanged. Ran on PostgreSQL and SQLite. |
| D1b | With the flag it records the policies and applies migrations in one run | FAIL | PASS | Same journey: `migrationsApplied: 1`, `markerHash`, `databasePoliciesUpdated`, summary, `meta`. All four targets. |
| D1d | A failed run leaves the policies unchanged | WEAK | WEAK | Runs on all four targets, but only asserts a non-zero exit before checking the marker (F08). MongoDB's own test is strong. |
| E1 | Existing database, no `meta.policies`, ref without `policies` | WEAK | WEAK | Still no test runs a ref without `policies` against a database and checks `meta` stays `{}`; code path unchanged. |
| E6 | MongoDB run fails on the second migration | WEAK | PASS | Asserts storage hash and policies unchanged, the first migration's `name` in the validator, the retry's exit 0, and the recorded policies after it. |

### Rows added by the decisions

| # | Decision | Verdict | What I checked |
|---|---|---|---|
| R1 | Policies belong to the database: the application space's marker governs every space | PASS | `databasePoliciesInForce` reads the application space only; `checkRunPolicies` checks once with `spaceId: app`; unit test "refuses db update … naming the marker". |
| R2 | `NamedRef` with a required name; `targetHash` for a hash, `@db`, `@empty`; `dbUpdate` refuses a ref for another contract | PASS | Types in `control-api/types.ts`; `orm/migrate.ts` sends `ref` only with a ref name; unit test for the internal error. |
| R3 | Invalid `meta.policies` is `CONTRACT.MARKER_ROW_CORRUPT`, from a result | WEAK | Code and `meta.space` correct; the envelope's advice deletes the row (F05). |
| R4 | `change` holds at least one strategy | PASS | Schema and `it.each` cases in framework and refs tests. |
| R5 | Policy-only run writes no ledger row; in-sync `db update` without the flag keeps its row | PASS | Runner tests on all four; integration journey "records the policies with db update --to <ref> … writes no ledger entry". |
| R6 | Off-graph detection, then policy comparison, then change policy, in CLI and control API | PASS | `migrate.ts` order; CLI no longer checks policies; unit test "reports a marker outside the migration graph before it compares the policies". |
| R7 | Runner compares the checked policies under its lock | PASS | Code on four runners and both families' sign; a concurrent-change test on each runner. Residual risk on MySQL and MongoDB in F11. |
| R8 | Postgres merges `meta.policies` in the statement | PASS | `metaRecordingPolicies` with `jsonb_set`; integration test keeps another `meta` key. |
| R9 | One policy check, in the control API | PASS | `orm/migrate.ts` no longer calls `checkRunPolicies`. |
| R10 | Framework owns the key, serialiser and overlay; value lists defined once | PASS | `database-policies.ts`; MySQL, Postgres, SQLite and Mongo adapters use `DATABASE_POLICIES_META_KEY` and `storedDatabasePolicies`; type test. |
| R11 | Internal names say "database policies" | PASS | No remaining `policiesOf`, `PolicyDifference`, `DEFAULT_POLICIES` or `policiesUpdated` in the policy code. |
| R12 | A difference names the ref file's key path | PASS | `DatabasePolicySetting` is `change`, `dataProtection.dataLoss`, `dataProtection.accessWidening`; reference updated. |
| R13 | Re-run commands repeat the flags the user gave | PASS | Both `rerunArgs`; unit test asserts `['--to', 'production', '--permit-policy-change']`. |
| R14 | `db sign`'s refusal repeats `--config` | PASS | `DbSignOptions.invocation`; test "hands the control client the invocation". |
| R15 | `db migrate --show` previews a policy refusal | PASS | `migrate-show.ts` runs `checkRunPolicies` after the off-graph check; two tests, refusal and consent. |
| R16 | MySQL and MongoDB run the `--to <ref>` journeys and the failed-run case | PASS | Both e2e files call `definePolicyMigrateJourneys`. The weak assertion is counted under D1d. |
| R17 | ADR 307 and the Migration System doc describe the policies | PASS | ADR 307 status note points at ADR 314; subsystem doc mentions `meta.policies`. |

### Summary

| Verdict | Round 1 (29 rows) | Round 2 (29 original + 17 added = 46 rows) |
|---|---|---|
| PASS | 24 | 43 |
| FAIL | 2 | 0 |
| WEAK | 3 | 3 (D1d, E1, R3) |
| NOT VERIFIED | 0 | 0 |
