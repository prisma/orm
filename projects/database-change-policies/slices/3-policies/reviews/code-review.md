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

## Round 3

Reviews `origin/main...HEAD` at `c53d71ad2e` (plus the merge of `main`, `a85fdf669b`). Persona: principal engineer.

### Summary

All four round-2 findings are fixed. The policy comparison now runs once per run, under the lock and before the first space, on every runner, and every `MIGRATION.MARKER_CAS_FAILURE` carries `reason`. A corrupt `meta.policies` gets advice that keeps the row. The failed-run journey now checks which failure it got.

One new defect matters: `db sign` on MongoDB now crashes with an internal error whenever the application space has a marker but is not being signed, for example because its schema does not match the contract (F13). It came in with the fix for F11/F12. Two smaller findings follow (F14, F15).

Verified this round by running, with output under `wip/`:

- **Framework policies:** `wip/review3-fw.txt` (18 tests).
- **CLI, 15 files (150 tests):** `wip/review3-cli.txt`, `wip/review3-cli2.txt`.
- **Refs:** `wip/review3-refs.txt`.
- **SQL family and MongoDB family signing:** `wip/review3-sqlfamily.txt`, `wip/review3-mongofamily.txt`.
- **Runners:** Postgres `wip/review3-pg.txt`, SQLite `wip/review3-sqlite.txt`, MongoDB `wip/review3-mongo-runner.txt`.
- **MySQL, against a private `mysqld`:** facade live test (extension DDL case) `wip/review3-mysql-live.txt`, runner branches `wip/review3-mysql-branches.txt`, adapter live test `wip/review3-mysql-adapter.txt`, CLI journeys `wip/review3-mysql-e2e.txt`.
- **Integration journeys on PostgreSQL, SQLite and MongoDB** (`cli.database-policies.{migrate,enforcement,mongo,postgres}.e2e.test.ts`, 72 tests): `wip/review3-e2e.txt`.
- **`pnpm check:error-reference`:** `wip/review3-errref.txt`.

All pass.

### Round-2 findings

| Finding | Verdict | Evidence |
|---|---|---|
| F05 — corrupt `meta.policies` advised deleting the row | Fixed in `87e153c606` | `errorMarkerPoliciesCorrupt` (`packages/1-framework/1-core/errors/src/execution.ts` 97–118) gives a `fix` and one `user-choice` that keep the row. The CLI and all four runners use it. `migrate-database-policies.test.ts` asserts `fix`, `nextActions` and `meta`; the Postgres runner test asserts the same under the lock. The reference entry describes the policies case separately. |
| F08 — failed-run journey passed on any failure | Fixed in `e0064d0747` | The journey asserts `MIGRATION.EXECUTION_FAILED` with `meta.failingSpace: 'app'` on the SQL targets, an unchanged ledger length and an unchanged marker. On MongoDB it asserts the known `CLI.UNEXPECTED` with the duplicate-key text (TML-3779). The suggested check of the first migration's column was not added; the MongoDB test covers that case separately. |
| F11 — extension DDL committed before the policy comparison on MySQL and MongoDB | Fixed in `87e153c606` | `expectedDatabasePolicies` moved from per-space options to `MigrationRunner.execute`. MySQL compares inside `withMarkerLock` before `#applySpaces`; Postgres takes the lock and compares before the first space; SQLite compares inside its exclusive transaction; MongoDB compares before the first space and keeps the compare-and-swap at the application space's marker write. The MySQL facade live test runs an extension plan first and asserts `extension_table` was not created; the Postgres runner test asserts no operation started. |
| F12 — moved policies reported as a moved storage hash | Fixed in `87e153c606` and `b82ce2b92e` | Conflicts are `SpaceMarkerHashConflict` (`reason: 'storageHash'`) or `SpaceDatabasePoliciesConflict` (`reason: 'databasePolicies'`, with `checked` and `comparison`). `db sign` fails as a whole with a `why` that names each moved setting. Every runner's hash-moved `MARKER_CAS_FAILURE` carries `reason: 'storageHash'`. The reference entry lists both causes. CLI, family and runner tests assert the `reason` payloads. |

### Findings

#### F13 — `db sign` on MongoDB throws an internal error when the application space is not being signed

Paths: packages/2-mongo-family/9-family/src/core/control-instance.ts 295–310 and 413–423; packages/2-sql-family/9-family/src/core/control-instance.ts 639–666; packages/1-framework/3-tooling/cli/src/control-api/operations/db-sign.ts 149–151 and 212–225.

`signContractSpaces` sets `inForce` whenever the application space has a marker, and always passes it to `signSpaces`. But it leaves the application space out of `toSign` when that space fails schema verification or lacks invariants its head ref requires. MongoDB's `checkSignPolicies` then looks for the application space in `spaces`, does not find it, and throws `InternalError('signSpaces was given database policies without the application space')`. This happens before any comparison.

Concrete failure: a MongoDB database is signed, and someone drops an index the contract declares. Before this round, `db sign` reported the application space's schema failure with its own exit code. Now it crashes with an internal error. The same happens when only an extension space is to be signed. The SQL family has the same throw, but reaches it only when the policies also moved.

No test covers it: the CLI tests use a fake family, and the MongoDB family tests always include the application space.

Suggestion: the policy check does not need the application space's contract. Drop the throw in both families. Either make `contract` optional on `SpaceDatabasePoliciesConflict` (`db-sign.ts` never reads it), or have the CLI pass the application contract with `expectedDatabasePolicies`. Keep the check itself: extension spaces must not be signed when the policies moved to migrations only. Add a MongoDB family test that calls `signSpaces` with only an extension space and `expectedDatabasePolicies`, and a CLI integration test of `db sign` on MongoDB with a schema mismatch and an existing marker.

#### F14 — MongoDB's failed compare-and-swap falls back to a storage-hash conflict with equal hashes

Paths: packages/3-targets/mongo/1-target/src/core/migrations/mongo-runner.ts 461–482; packages/2-mongo-family/9-family/src/core/control-instance.ts 274–292.

When the swap fails but the storage hash still matches, both the runner and `signSpaceMarker` compare the policies again. Only `moved` gives the policies failure. If the found policies are `unreadable`, or `held` (stored in a different form that reads the same), the code reports `reason: 'storageHash'` with `expectedStorageHash` equal to `foundStorageHash`. That is the round-2 F12 message ("changed the marker from X to X") on a narrower path. An unreadable value there should be `errorMarkerPoliciesCorrupt`, as everywhere else.

Suggestion: when the hashes hold, map `unreadable` to `errorMarkerPoliciesCorrupt` and treat any other result as a policies conflict, since the policies filter is the only other reason the swap can fail.

#### F15 — `MigrateOptions` lost its doc comment to an orphaned block

Path: packages/1-framework/3-tooling/cli/src/control-api/types.ts 639–659.

`MigrateTarget` and its JSDoc were inserted between `MigrateOptions`'s doc block ("Options for the aggregate-walking `migrate` operation…") and the interface. The old block is now orphaned, and `MigrateOptions` has no doc on a public control-API type. The repository's `jsdoc-line-width` rule calls out orphaned doc blocks.

Suggestion: move `MigrateTarget` and its comment above the old block, so the block sits directly on `MigrateOptions` again.

### Deferred

| Item | Why deferred |
|---|---|
| The MongoDB runner reports a failed schema command as `CLI.UNEXPECTED`; the failed-run journey asserts that code on MongoDB. | Predates the slice; TML-3779. The journey assertion will need updating when that ticket lands. |
| On MongoDB, a policy change between the runner's first comparison and the application space's marker write is caught only at that write, after extension spaces ran. | MongoDB has no lock. The error reference states this, and the brief records it as accepted behaviour. |
| The marker-destination shape is declared in several places outside the runners. | Predates the slice; the spec records it as a separate refactor. |
| Data protection enforcement, `migration plan --to <ref>` checks, Composer. | Slices 4 and 5. |

### Acceptance-criteria verification

Every row below was checked against the code and the test assertions at this commit.

#### Pre-investigated edge cases

| # | Case | Verdict | What I checked |
|---|---|---|---|
| E1 | Existing database, no `meta.policies`, ref without `policies` | PASS | New journey `applies a ref without policies to a database with none, and records none` (all four targets): `migrationsApplied: 1`, `databasePoliciesUpdated` absent, marker `meta` strictly `{}`. The enforcement journey runs `db migrate`, `db update` and `db sign` on such a database and asserts `meta: {}`. |
| E2 | Ref declares only `change`, marker has nothing | PASS | `migrate-database-policies.test.ts`: ref declares `{change: ['migrate']}`; difference lists only `change`; runner gets `MIGRATE_ONLY_WRITTEN` with both data settings at their defaults. |
| E3 | Ref declares the defaults, marker has nothing | PASS | `writes nothing when the ref declares the policies already in force` (control API) and `database-policies.test.ts` in the CLI. |
| E4 | `--permit-policy-change` with nothing pending | PASS | Control-API test runs the runner with no edges; journey `records the policies with no migration to run` asserts summary `Policies updated: change: migrate` and an unchanged ledger, on all four targets. |
| E5 | Postgres run fails after the policy check | PASS | Shared journey on PostgreSQL asserts `EXECUTION_FAILED` in space `app`, marker hash and `meta.policies` unchanged, ledger unchanged. The rollback of the first migration's DDL is not asserted directly. |
| E6 | MongoDB run fails on the second migration | PASS | MongoDB test asserts the first migration's field in the validator, marker unchanged, and a retry with the flag records the policies. |
| E7 | `db update --dry-run` on a migrations-only database | PASS | Enforcement journey asserts the whole `CHANGE_POLICY_FORBIDS` envelope for the dry run; `db-run.ts` checks before planning. |
| E8 | `db sign` with no marker | PASS | Journey `signs a database with no marker`: exit 0, `meta: {}`. `inForce` is undefined with no application marker. |
| E9 | `db sign` on a migrations-only database | PASS | Enforcement journey asserts `forbidsMigrationsOnly('db sign')` and an unchanged marker. |
| E10 | Extension space marker carries `meta.policies` | WEAK | Code reads only the application space's marker (`databasePoliciesInForce`, each runner's check) and hands `databasePolicies` only to the application space. No test plants policies on an extension marker. |
| E11 | Marker `meta.policies` is not a valid object | PASS | `CONTRACT.MARKER_ROW_CORRUPT` with advice that keeps the row, asserted in the control API and the Postgres runner test. |
| E12 | `migration ref set` on a ref with policies and invariants | PASS | `ref-set.test.ts`, `refs.policies.test.ts`, and the enforcement journey assert both kept. |
| E13 | `db update` advancing a ref that carries policies | PASS | `ref-advancement.test.ts` `keeps the invariants and policies the ref declares`; journey with `--advance-ref staging`. The `db` ref takes the same `advanceRef` path. |
| E14 | MySQL `db migrate` twice | PASS | MySQL adapter live test `records database policies in meta, and later marker writes without them leave meta`, run against a private server. |
| E15 | Off-graph marker, `change: [migrate]` | PASS | `marker-mismatch.test.ts` single `user-choice`; PostgreSQL journey asserts the envelope. |
| E16 | Off-graph marker, default policies | PASS | `marker-mismatch.test.ts` asserts only the two `db update` actions. |

#### Slice-specific done conditions

| # | Condition | Verdict | What I checked |
|---|---|---|---|
| D1a | Mismatching ref fails before any DDL, four targets | PASS | Shared journey asserts the whole `POLICY_MISMATCH` envelope, marker, ledger and `db schema --json` unchanged. Ran on all four. |
| D1b | With the flag, writes `meta.policies` and applies migrations in one run | PASS | Shared journey, all four targets. |
| D1c | Policy-only run writes the marker | PASS | Shared journey, all four targets; runner tests on each target. |
| D1d | A failed run leaves the policies unchanged | PASS | Shared journey now asserts which failure occurred (F08). |
| D1e | `db update` and `db sign` refused under `change: [migrate]` | PASS | Enforcement journey on all four targets, whole envelopes. |
| D1f | `db update` and `db migrate` behave as today with no policies | PASS | Enforcement journey on all four targets. |
| D2a | Unit: parser defaults and validation | PASS | `database-policies.test.ts` (framework). |
| D2b | Unit: policy differences | PASS | Same file, and `compareMarkerDatabasePolicies` cases. |
| D2c | Unit: `advanceRef` keeps invariants and policies for all three callers | PASS | `ref-set.test.ts`, `ref-advancement.test.ts`, `db-sign.ref-advancement.test.ts`. |
| D2d | Unit: both error builders assert whole envelopes | PASS | `policy-errors.test.ts`. |
| D2e | Unit: `marker-mismatch` for both policy cases | PASS | Two tests in `marker-mismatch.test.ts`. |
| D3 | MySQL marker test proves `meta` survives an upsert | PASS | MySQL adapter live test, run locally. |
| D4a | `pnpm check:error-reference` passes | PASS | `wip/review3-errref.txt`. |
| D4b | Skill, glossary and ADRs say what the spec says | PASS | Unchanged since round 2 except the reference entries for `MARKER_ROW_CORRUPT` and `MARKER_CAS_FAILURE`, which now match the code. |

#### Rows added by the decisions

Rows R1 to R17 from round 2 stand. R3 (invalid `meta.policies`) moves from WEAK to PASS with F05. R7 (runner compares under its lock) is PASS, with the F11 residual closed on MySQL. F13 is a regression in the `db sign` part of R7 on MongoDB, recorded as a finding rather than a row.

#### Summary

| Verdict | Round 3 (16 edge cases + 14 done conditions) |
|---|---|
| PASS | 29 |
| WEAK | 1 (E10) |
| FAIL | 0 |
| NOT VERIFIED | 0 |

## Round 4

Reviews `8693a70269...HEAD` at `6f6e6c1200`. Persona: principal engineer.

### Summary

F13, F14 and F15 are fixed, and E10 now has a test. `db sign` compares the policies whether or not the application space is being signed, on all four targets. A shared journey proves the MongoDB crash is gone. MongoDB's failed marker swap is now reported by its cause, with one bounded retry. SQL runners share `checkDatabasePoliciesHeld`.

Two small new findings, both about MongoDB's retry: the error reference does not describe it (F16), and its classification code is written twice (F17).

Verified by running, with output under `wip/`:

- **Errors, framework, CLI:** `wip/review4-errors.txt` (31), `wip/review4-fw.txt` (20), `wip/review4-cli.txt` (56).
- **SQL family signing and `checkDatabasePoliciesHeld`:** `wip/review4-sqlfamily.txt` (15).
- **MongoDB family, runner and adapter:** `wip/review4-mongofamily.txt` (29), `wip/review4-mongo-runner.txt` (34), `wip/review4-mongo-adapter.txt` (4).
- **Postgres and SQLite runners:** `wip/review4-pg.txt` (7), `wip/review4-sqlite.txt` (8).
- **MySQL, against a private `mysqld`, stopped afterwards:** facade live test `wip/review4-mysql-live.txt` (6), CLI journeys `wip/review4-mysql-e2e.txt` (24).
- **Integration journeys on PostgreSQL, SQLite and MongoDB** (`enforcement`, `migrate`, `mongo` files): `wip/review4-e2e.txt` (74).
- **`pnpm lint:deps`** (`wip/review4-lintdeps.txt`) and `pnpm typecheck` in the ten touched packages.

All pass.

### Round-3 findings

| Finding | Verdict | Evidence |
|---|---|---|
| F13 — `db sign` on MongoDB threw an internal error when the application space was not being signed | Fixed in `7d78c41fdb` | `SpaceDatabasePoliciesConflict` no longer carries `contract`, so neither family needs the application space in `spaces`. Both throws are gone. Each family has two new tests: an extension space alone signs when the policies hold and is not signed when they moved. The new shared journey `reports the schema failure of an application space it cannot sign, on a database with a marker` runs on all four targets. It asserts `ok: false`, the application space `failed`, and an unchanged marker. Before the fix it would have crashed on MongoDB. |
| F14 — MongoDB's failed swap fell back to a storage-hash conflict with equal hashes | Fixed in `7d78c41fdb` and `6f6e6c1200` | Runner (`mongo-runner.ts` `updateMarker`, 500–528) and family (`signSpaceMarker`, 255–284): if the storage hash moved, the failure is `reason: 'storageHash'`. Unreadable policies raise the corrupt-marker error. Moved policies raise the policies failure. Policies that read the same retry once with the raw value found; a second failure reports moved policies with checked equal to found, and the why says they were stored again in a different form. Runner and family tests cover unreadable, a successful retry and a second failure. |
| F15 — `MigrateOptions` lost its doc comment | Fixed in `3a813c7b9c` | `MigrateTarget` now sits above the `MigrateOptions` doc block. |
| E10 — no test of an extension marker carrying policies | Fixed in `a26c6da7ff` | SQLite runner test plants `change: [migrate]` on an extension marker, runs with the default policies checked, and asserts the run succeeds, records the application space's policies and leaves the extension marker's value alone. |

### Findings

#### F16 — The error reference does not describe MongoDB's retry or a failure whose checked and found policies are equal

Path: docs/reference/error-reference.md, `MIGRATION.MARKER_CAS_FAILURE` entry (line 1725).

The entry says the `why` names each setting that moved. After MongoDB's second failed swap the failure carries equal `checkedDatabasePolicies` and `foundDatabasePolicies`, and the `why` says the policies were stored again in a different form. The entry does not mention this, so a reader with equal payloads has no explanation. It also says the MongoDB write-time failure fails "the same way", but that failure comes after earlier spaces ran, so `databaseUnchanged` can be false.

Suggestion: add one sentence for the MongoDB case. State that the swap is retried once when the policies were stored again unchanged, and that a second failure reports equal checked and found policies. State that this failure can follow changes made by earlier spaces.

#### F17 — The swap-failure classification is written twice for MongoDB

Paths: packages/3-targets/mongo/1-target/src/core/migrations/mongo-runner.ts 500–528; packages/2-mongo-family/9-family/src/core/control-instance.ts 255–284.

The runner and the family each have the same loop: swap, re-read, check the hash, check the policies, retry once. They already differ slightly. The family compares both hashes with `expected`; the runner compares only the storage hash with `expectedFrom`. The next change to the retry rule has to be made in two places and tested twice.

Suggestion: move the classification after a failed swap into `marker-policies.ts` beside `checkMarkerPolicies`. It should return `hashMoved`, `policiesMoved`, `unreadable` or `retryWith(raw)`. Each caller then maps that result to its own failure type.

### Deferred

Unchanged from round 3. Also: MongoDB's `initMarker` is a plain `insertOne`. A concurrent first marker write fails as a duplicate key, not as a classified conflict. This predates the slice and is not a silent overwrite.

### Acceptance rows these changes touch

| # | Row | Round 3 | Round 4 | What I checked |
|---|---|---|---|---|
| E8 | `db sign` with no marker proceeds | PASS | PASS | No policies are passed when there is no application marker; journey unchanged and passing on all four targets. |
| E9 | `db sign` on a migrations-only database is refused | PASS | PASS | Enforcement journey on all four targets. The family check no longer depends on the application space being signed. |
| E10 | Extension marker policies are ignored | WEAK | PASS | New SQLite runner test (above). The CLI reads only the application space's marker. |
| E11 | Unreadable `meta.policies` gives advice that keeps the marker | PASS | PASS | New summary and wording asserted as a whole envelope in `execution.test.ts` and the control-API test. New runner tests on SQLite and MySQL (unreadable under the lock or transaction), plus the MongoDB runner and family after a failed swap. The reference entry matches the new wording. |
| D1e | `db update` and `db sign` refused under `change: [migrate]` | PASS | PASS | Enforcement journey on all four targets. |
| R7 | The runner compares the checked policies under its lock | PASS | PASS | Postgres, SQLite and MySQL use `checkDatabasePoliciesHeld` (`packages/2-sql-family/9-family/src/core/migrations/database-policies-check.ts`), unit-tested for held, moved and unreadable. MongoDB compares before the first space and guards the write. |

Totals: 30 PASS of 30 edge cases and done conditions.

## Round 5

Reviews `4fa51b5430...HEAD` at `21b10444b4`. Persona: principal engineer.

### Summary

F16 and F17 are fixed. MongoDB now guards the application marker's write with an aggregation filter that compares the policy settings, not their stored form. That removes the retry and the "stored again in a different form" case. Runner and `db sign` share `markerSwapFailure`.

I probed the new filter against a real in-memory MongoDB. It agrees with `databasePoliciesOf` in every case I tried except one: extra keys inside `meta.policies` (F18). A changed-and-restored marker is still reported with equal hashes (F19). One doc comment is stale (F20). All three are small.

Verified by running, with output under `wip/`:

- **Framework, CLI:** `wip/review5-fw.txt` (19), `wip/review5-cli.txt` (19).
- **MongoDB family (`control.test.ts`, `marker-policies.test.ts`), runner, adapter:** `wip/review5-mongofamily.txt` (34), `wip/review5-mongo-runner.txt` (33), `wip/review5-mongo-adapter.txt` (13).
- **Integration:** `cli.database-policies.mongo.e2e.test.ts` and `mongo/target-runner/runner-wire.test.ts`, `wip/review5-e2e.txt` (66).
- **`pnpm typecheck`** in the four touched packages, and `pnpm check:error-reference` (`wip/review5-errref.txt`).
- **Filter probe:** `wip/probe/filter-probe.test.ts`, a scratch file outside the test tree, run through the adapter package against `mongodb-memory-server`. For each stored `meta.policies` it records whether `databasePoliciesOf` reads it as the defaults and whether `updateMarker(…, DEFAULT_DATABASE_POLICIES)` swaps. Results: `wip/review5-probe-results.txt`.

All pass.

### Round-4 findings

| Finding | Verdict | Evidence |
|---|---|---|
| F16 — the reference did not describe MongoDB's retry or equal payloads | Fixed in `c58489cd0b` and `21b10444b4` | The retry is gone, so equal checked and found policies can no longer occur. The `MARKER_CAS_FAILURE` entry now says MongoDB checks before the first space and guards the application marker's write "however they are stored". It also says a failure there can come after earlier spaces and carry `databaseUnchanged: false`. The `MARKER_ROW_CORRUPT` entry covers the unreadable case after a failed write. |
| F17 — swap-failure classification written twice | Fixed in `c58489cd0b` | `markerSwapFailure` (`packages/2-mongo-family/9-family/src/core/marker-policies.ts`) returns `storageHashMoved`, `policiesMoved` or `policiesUnreadable`. Runner and family map it to their own types. Six unit tests in the family's `marker-policies.test.ts`. |

### Probe: does the filter match exactly when `databasePoliciesOf` reads the stored value as the checked policies?

Checked policies: the defaults. "Reads as" means `databasePoliciesOf` returns ok and equals the defaults.

| Stored `meta.policies` | Reads as checked | Filter swaps | Agree |
|---|---|---|---|
| absent (adapter test) | yes | yes | yes |
| `{}` | yes | yes | yes |
| `{ dataProtection: {} }` | yes | yes | yes |
| `change` with duplicates `[migrate, reconcile, migrate]` | yes | yes | yes |
| strategies or fields in another order (adapter test) | yes | yes | yes |
| `null` | no (unreadable) | no | yes |
| `{ change: null }` | no | no | yes |
| `{ dataProtection: { dataLoss: null } }` | no | no | yes |
| `{ change: [] }` | no | no | yes |
| `{ change: [migrate, reconcile, bogus] }` | no | no | yes |
| `{ change: [[migrate, reconcile]] }` | no | no | yes |
| an array of objects | no | no | yes |
| `{ change: [migrate, reconcile], extra: 1 }` | no (unreadable) | **yes** | **no** |
| `{ dataProtection: { extra: 1 } }` | no (unreadable) | **yes** | **no** |

The adapter's own tests add other settings, absent when others were checked, a non-object value, a non-object `dataProtection`, and a non-list `change`. All agree. Partial stored settings agree by construction: an absent setting matches only when the checked value is its default (`missingWhenDefault`). A wrong-typed present setting never equals a valid level.

### The other two questions

- **Changed and restored, reported as a storage-hash conflict.** Failing is correct: the swap failed, so another process wrote the marker in between. Calling it `storageHash` is a guess, because the code cannot tell which field moved, and the payload then has equal hashes. See F19.
- **Dropping the profile-hash comparison in `signSpaceMarker`.** No real case is lost. The swap filter matches on `storageHash` (and the policies) only, never on `profileHash`, so a profile-only change cannot make the swap fail. The only change in outcome is a marker whose profile hash and policies both moved. It is now reported as `policiesMoved` instead of `storageHash`. That is the condition that actually failed the filter. The pre-swap check still compares both hashes with `expected`. Not guarding `profileHash` in the swap predates the slice.

### Findings

#### F18 — The MongoDB filter accepts policies with extra keys, which `databasePoliciesOf` rejects

Path: packages/3-targets/mongo/2-adapter/src/core/migrations/mongo-control-adapter.ts 55–113 (`policiesHoldExpr`).

The schema rejects undeclared keys at both levels (`'+': 'reject'`). The filter checks only the three known settings. The probe shows `{ change: [migrate, reconcile], extra: 1 }` and `{ dataProtection: { extra: 1 } }` are unreadable to the reader but pass the swap.

Effect: suppose another process adds an extra key after the run's first check. The application marker's write then succeeds instead of failing. The marker is left with unreadable policies (unless this run records new ones). The next command raises `MARKER_ROW_CORRUPT`, with advice that keeps the marker, so nothing is lost silently. The window is narrow.

Suggestion: require the key sets as well. For example, `$setIsSubset` of the keys of `$objectToArray` on `meta.policies` against `['change', 'dataProtection']`, and on `dataProtection` against `['dataLoss', 'accessWidening']`. Add the two extra-key cases to the adapter's "does not swap" table.

#### F19 — A changed-and-restored marker is reported with equal storage hashes

Paths: packages/2-mongo-family/9-family/src/core/marker-policies.ts 34–41; packages/1-framework/3-tooling/cli/src/orm/db/sign.ts 270.

When the swap fails but the marker read afterwards holds both the hash and the policies, `markerSwapFailure` returns `storageHashMoved`. `db sign` then prints "changed the marker from X to X". The runner's failure has `expectedStorageHash` equal to `foundStorageHash` and no `why`. This is the round-2 F12 message on a rarer path. The doc comment explains it, but the user does not see that comment.

Suggestion: keep the code and reason. Give this case its own `why`, for example "Another process changed the marker and changed it back while this run was writing it. Run the command again." Either add a `restored` kind to `MarkerSwapFailure`, or let callers detect equal hashes.

#### F20 — Stale doc comment on the runner's `checkedPolicies`

Path: packages/3-targets/mongo/1-target/src/core/migrations/mongo-runner.ts 126.

The comment still says "the marker's `meta.policies` it found holding them; the marker update swaps only while the marker still stores that value". The field is now just `DatabasePolicies`, and the swap compares settings, not the stored value.

Suggestion: "The policies the run checked; the application marker is written only while its policies read as these."

### Deferred

Unchanged from round 4.

### Acceptance rows these changes touch

| # | Row | Round 4 | Round 5 | What I checked |
|---|---|---|---|---|
| E6 | MongoDB run fails on the second migration | PASS | PASS | The MongoDB integration file passes: first migration kept, policies unchanged, retry records them. |
| E11 | Unreadable `meta.policies` keeps the marker | PASS | PASS | Unreadable after a failed swap raises `errorMarkerPoliciesCorrupt` in the runner and a `databasePolicies` conflict of kind `unreadable` in `db sign`; family and runner tests assert it. F18 is a narrow gap where the write is not refused, but the advice still keeps the marker. |
| R7 | The runner compares the checked policies under its lock (MongoDB: before the first space, and at the guarded write) | PASS | PASS | `checkDatabasePolicies` before the first space; `updateMarker` guarded by `policiesHoldExpr`; adapter tests against a real MongoDB; the probe above. |

Totals: 30 PASS of 30 edge cases and done conditions.
