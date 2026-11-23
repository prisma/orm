# Review: the Postgres migration runner limits each wait for a table lock

Reviewed: `wip/lock-timeout/design.md` against `main` at `988cdf234a`, the issue in `issue.json`, and the prior art in `prior-art-a.md` to `prior-art-d.md`.

## Verdict

Sound with changes.

Setting `lock_timeout` for the rest of the transaction once the runner holds the marker lock is the right mechanism, and it is the only one that works through the Prisma Postgres pooler. A 5 second default with no retry is defensible. Three things in the design are wrong or missing and must change before implementation: the marker lock wait is not unbounded when the session already has a `lock_timeout`; the error handling cannot be done in one place in the current code and the design does not say where it goes; and schema verification after the operations can time out on tables the migration never touched. The rest are corrections to what the design says, plus validation and tests.

## How I checked

Verified:

- Code reading of every file the brief names, cited by file and line below.
- Postgres 17 documentation for `lock_timeout` (runtime-config-client): "The time limit applies separately to each lock acquisition attempt", it covers "a table, index, row, or other database object", explicit and implicit locks, and a value without units is milliseconds.
- Postgres 17 source: `ProcSleep` in `src/backend/storage/lmgr/proc.c` arms `LOCK_TIMEOUT` together with `DEADLOCK_TIMEOUT` for every heavyweight lock wait, and signals a blocking autovacuum worker to cancel only from the deadlock check and only when it is not `PROC_VACUUM_FOR_WRAPAROUND`. `pg_get_expr_worker` in `src/backend/utils/adt/ruleutils.c` opens the relation with `try_relation_open(relid, AccessShareLock)`.
- Single-session experiments on PGlite 0.5.16 (PostgreSQL 18.6), script in `wip/lock-timeout/pglite-probe.mjs`:
  - `set_config('lock_timeout', $1, true)` with the number `5000` as the parameter gives `5s`.
  - `ROLLBACK TO SAVEPOINT` undoes a later `set_config(…, true)`; `RELEASE SAVEPOINT` keeps it.
  - A user's `SET LOCAL lock_timeout = 0` replaces the runner's value for the rest of the transaction.
  - `ROLLBACK` restores the session's value, including after an error. After an error every statement fails with `25P02` until the rollback.
  - `-1` fails with `22023` ("outside the valid range … (0 ms .. 2147483647 ms)"), `2147483648` fails with `22023`, `2147483647` is accepted, and `1.5` becomes `2ms`.

Not verified, because I could not run two connections against a real server: the local Postgres.app refuses connections from this process, and a private Postgres 17 cluster in `wip/` would not start because the machine has no System V shared memory left. PGlite has one session only. So the claims about lock waits between sessions rest on the documentation and source above, not on experiments. The issue's own reproduction (PostgreSQL 17.11) covers the basic case.

## Findings, most severe first

### 1. High: a `lock_timeout` the session already has still limits the marker lock wait

What happens: design item 7 says the marker advisory lock "still waits without limit". That holds only when the session has no `lock_timeout`. The runner sets nothing before `pg_advisory_xact_lock` (`runner.ts:194-195`), so the session's value applies to that wait. The session gets one from the connection string (`?lock_timeout=…` and `options=-c lock_timeout=…` are passed through to `pg`, `3-driver/src/session-settings.ts:6-23`), from `PGOPTIONS`, or from `ALTER ROLE … SET lock_timeout` / `ALTER DATABASE … SET`. Those are exactly the issue's own workaround and the role setting strong_migrations' README recommends. Advisory lock waits go through the same lock manager wait (`ProcSleep`), so they are covered (documentation: "or other database object").

Result: replicas that migrate at start-up and are meant to wait for each other fail at the marker lock. The `55P03` is thrown from `acquireLock`, before the limit is set, so under the design it is not even mapped to the new error: it escapes `execute` raw. The upgrade note's "A `lock_timeout` set on the connection no longer applies inside a migration" is also false for this wait.

Recommendation: set `lock_timeout` to `0` for the transaction before the marker lock, in the same statement that sets `lc_monetary`, and set the configured value after the lock is held:

```sql
SELECT set_config('lc_monetary', $1, true), set_config('lock_timeout', '0', true);
SELECT pg_advisory_xact_lock(hashtext($1));
SELECT set_config('lock_timeout', $1, true);
```

Then item 7 is true whatever the session has. Add a test where the connection string sets `options=-c lock_timeout=100ms`, a second connection holds the marker lock for one second, and the runner still succeeds.

### 2. High: the error mapping needs four sites, and the design names none

The design says a `55P03` "from any statement after the limit is set" becomes `MIGRATION.LOCK_TIMEOUT` with `databaseUnchanged: true`. In the current code a `55P03` can surface at these places:

| Where | Code | What happens today |
| --- | --- | --- |
| An operation's execute step | `runExecuteSteps`, `runner.ts:576-647` | Caught as `SqlQueryError` and returned as `MIGRATION.EXECUTION_FAILED`. It never reaches an outer catch. |
| Idempotency probe (postcheck run before the operation) | `expectationsAreSatisfied`, `runner.ts:686` | Thrown raw. |
| Precheck and postcheck steps | `runExpectationSteps`, `runner.ts:442` | Thrown raw. |
| Row counts after a failed check | `runner.ts:451`, `rowsWithoutValue` `:562`, `rowsHoldingValue` `:526-531` | First count of `rowsWithoutValueFailure` thrown raw (`required-column.ts:150-170`); the other counts are caught and stop counting (`rows-holding-value.ts:160-175`), which is harmless. |
| Policy check before the first space | `checkDatabasePoliciesHeld`, `runner.ts:319` | Thrown raw. |
| Control tables | `ensureControlTables`, `runner.ts:427-430` (only `CREATE … IF NOT EXISTS`, `contract-free/control-bootstrap.ts`) | Thrown raw. Unlikely: every other writer of these tables holds the marker lock. |
| Marker read and write | `readMarker` `:198`, `upsertMarker` `:870-880` | Thrown raw. Unlikely, same reason. |
| Schema verification | `family.introspect`, `runner.ts:221` | Thrown raw. Likely; see finding 3. |
| Ledger writes | `recordLedgerEntries`, `runner.ts:920` | Thrown raw. Unlikely. |
| `COMMIT` | `runner.ts:295-299` | Thrown raw. Only possible when deferred constraint triggers run at commit and wait for a row lock; the transaction-local setting still applies then. Rare. |

A thrown error goes to `execute`'s catch (`runner.ts:287-290`), which rolls back and rethrows. The caller gets a raw `SqlQueryError` with no `databaseUnchanged`, no `failingSpace`, and the CLI's unexpected-error path.

One central place is not possible, because `runExecuteSteps` swallows the error into a result before any outer catch sees it, and only `applyPlan` knows the operation. Recommended shape: one helper that turns a `SqlQueryError` with SQLSTATE `55P03` into the failure, called from:

1. `runExecuteSteps`, checked before the general `SqlQueryError` branch.
2. A `catch` on the per-operation `try` in `applyPlan` (`runner.ts:355-412`), which covers the idempotency probe, prechecks, postchecks and counts, and names the operation and the phase.
3. A `try`/`catch` around each `executeOnConnection` call and around the policy check in `executeSpaces` (`runner.ts:317-337`), which gives `failingSpace` and covers control tables, marker, verification and ledger. Each needs a phase in the payload, such as `verifySchema` or `ledger`.
4. `execute`'s commit catch.

After the rollback each one returns `notOk(withDatabaseUnchanged(failure, true))`; `rollbackAfterFailure` already ignores a failed `ROLLBACK`. After a `55P03` every later statement fails with `25P02`, and none runs on these paths except the optional counts, which are caught. `readWithDefaultOutputSettings` runs its restore after a failure and ignores its error (`2-adapter/src/core/control-adapter.ts:1855-1866`), so introspection is safe too.

Two code facts the design should state:

- `MIGRATION.LOCK_TIMEOUT` must be added to `SqlMigrationRunnerErrorCode` in `packages/2-sql-family/9-family/src/core/migrations/types.ts:424-433`. That is a change to the SQL family, not the framework; the framework type accepts any `MIGRATION.${string}` (`control-migration-types.ts:388`).
- The CLI builds advice in the framework (`cli/src/utils/runner-failure-advice.ts:769-803`). A new code gets the general "Resolve the cause the failure names, then re-run db migrate". To keep the framework unchanged, the runner's `why` must carry the advice: the limit, that the database is unchanged, how to find the blocking session (`pg_stat_activity` with `pg_blocking_pids`), and `migrations.lockTimeoutMs`.

Also: SQLSTATE `55P03` is also raised by `NOWAIT` (`SELECT … FOR UPDATE NOWAIT`, `LOCK TABLE … NOWAIT`) in a migration's own SQL, and when `lockTimeoutMs` is `0` that is the only source. The error should not claim "waited 5000 ms" from the SQLSTATE alone; carry Postgres's message in the payload and word the summary as "could not get a lock". Optionally treat `40P01` (deadlock detected) the same way: it is equally safe to run again and today it is reported as `MIGRATION.EXECUTION_FAILED`.

### 3. Medium: schema verification can time out on a table the migration never touched

What happens: after the last operation, `executeOnConnection` introspects every schema of the contract (`runner.ts:220-237`, `2-adapter/src/core/control-adapter.ts:700-735`). The introspection queries call `pg_get_expr` through `information_schema.columns.column_default`, through `pg_indexes`, and directly (`control-adapter.ts:1097`, `:1145`). `pg_get_expr` takes `AccessShareLock` on each relation it reads. So introspection waits behind any other session's `ACCESS EXCLUSIVE` lock on any table in those schemas: a `TRUNCATE` or `LOCK TABLE` in an application transaction, `VACUUM FULL`, `CLUSTER`, or another tool's `ALTER TABLE`. It does this while the runner holds every lock its operations took.

Today that wait has no limit, so the design improves it. But the timeout then comes after every operation succeeded, from a statement that belongs to no operation, and the waited-for table is one the user did not touch. The error must say it happened while verifying the schema, and the design should list this case.

### 4. Medium: the worst-case time readers are blocked is cumulative, and the design does not say so

The limit applies to each lock acquisition. A table locked by an early statement stays locked until `COMMIT`, so its readers wait for: the early statement's own wait (up to the limit; new readers queue behind a waiting `ACCESS EXCLUSIVE` request), plus every later lock wait in the run (each up to the limit; one DDL statement can take several locks, such as the referenced table of a foreign key), plus the execution time of everything after it, including introspection (several statements per schema, each able to wait) and the ledger. With `k` later lock waits that each end just under the limit, the bound is about `k × 5 s` plus execution time, and no timeout fires. In practice blockers are either short (milliseconds) or long (they exceed the limit), so the sum is rare, but the design should state it instead of implying "at most the limit".

Two patterns repeat the window rather than lengthen it:

- Replicas that all migrate at start-up queue on the marker lock. If a blocker holds a table, each replica in turn takes the marker lock, waits the full limit, and rolls back. Readers of that table are blocked for about `replicas × limit`, with small gaps. With 20 replicas and 5 seconds that is about 100 seconds.
- An orchestrator that restarts a failed pod reruns the migration on a schedule, each run blocking for up to the limit.

Holding earlier locks while waiting for a later one creates no new deadlock: `lock_timeout` only ends waits. Deadlocks with application transactions are still found after `deadlock_timeout` (`40P01`), as today.

Recommendation: write the bound and both patterns in the design and the docs. Taking every table lock up front with one `LOCK TABLE` would make a timeout happen before expensive work, but it lengthens the time early-locked tables stay blocked, so I would not do it by default.

### 5. Medium: a limit at or below `deadlock_timeout` stops autovacuum from being cancelled

Postgres cancels a normal autovacuum that blocks a lock request only from the deadlock check, which runs after `deadlock_timeout` (default 1 s) (`ProcSleep`). With a 5 s limit, an autovacuum on the table is cancelled after about 1 s and the migration proceeds. With `lockTimeoutMs` at or below `deadlock_timeout`, the lock timeout fires first, autovacuum is never cancelled, and every migration on a table being vacuumed fails. Document this next to the setting.

How often an ordinary deploy fails under 5 s with no retry (inferred):

| Blocker | Under the design | Wanted? |
| --- | --- | --- |
| Normal autovacuum | Cancelled after about 1 s; the migration succeeds. | Yes |
| Anti-wraparound autovacuum | Never cancelled; fails on every attempt until it ends, which can take hours on a large table. | Yes; the alternative is an outage of that length. |
| Manual `VACUUM` / `ANALYZE` from a cron job | Not cancelled; fails statements that need `SHARE UPDATE EXCLUSIVE` or stronger. | Yes |
| Long analytics or reporting query | Fails any `ACCESS EXCLUSIVE` DDL on its tables. | Yes |
| `pg_dump` | Holds `ACCESS SHARE` on every table it dumps; fails such DDL for the whole dump. | Yes, but deploys during backup windows fail repeatedly. |
| Idle-in-transaction session that read the table | Fails until someone ends that session. Running again does not help. | Yes; the advice must say how to find it. |
| Application transaction holding row locks over 5 s | Fails `UPDATE` backfills (row-lock waits are covered) and `CREATE INDEX` (`SHARE` conflicts with writers). | Mostly yes |
| Another replica's start-up migration | Serialised by the marker lock, so no table lock conflict between runners. | Yes |

The SQLite `busy_timeout` comparison in the issue is weak support for the number: SQLite readers do not queue behind a waiting writer.

### 6. Medium: the control API cannot set the limit

`createPostgresControlClient` builds its client from the shared `controlComponents` (`9-facade/src/exports/control.ts:31-40`). Programmatic deploys through the control API would always get 5 s, with no way to raise it or turn it off. Add `lockTimeoutMs` to `PostgresControlClientOptions` as well. It is a Postgres facade option, so it changes nothing under `packages/1-framework`. Build both from one function that makes the target descriptor with the value.

Related: `defineConfig` spreads `options.migrations` into the framework's `migrations` section (`9-facade/src/config/define-config.ts:75`). The config loader would not reject the extra key (arktype keeps undeclared keys by default; `config-loader/src/orm-section.ts:89`), but it would place a Postgres setting in a framework-owned section. Take `lockTimeoutMs` out before spreading, and pass it only to the descriptor.

### 7. Medium: validate the value where the config is written

Without validation, a bad value fails inside the transaction, after the marker lock, as a raw `22023` from `set_config`. Postgres accepts integers from 0 to 2147483647 ms, rounds fractions (`1.5` becomes `2ms`), and rejects negatives and larger values (verified above). Validate in `defineConfig` and in the control client options: an integer, `0 ≤ n ≤ 2147483647`. Reject `NaN`, `Infinity`, negatives and fractions with a structured error. Send it as text with its unit, `` `${ms}ms` ``, so the unit never depends on the driver. `pg` already turns a number into text, and PGlite gives `5s` for the number `5000`.

### 8. Medium: the reason given for rejecting retry is not accurate

The design rejects automatic retry because "it reruns the whole transaction, data changes included". Rerunning is exactly what the design asks the caller to do, and it is safe: every statement, data transforms included, runs in the one transaction (`runner.ts:283-301`), so a timeout leaves nothing behind except consumed sequence values. The real costs are different: a long backfill done before a later statement times out on another table is thrown away and repeated, which loads the database again; and the command takes longer. Say that instead. If the choice is no retry, the advice for a migration with a long backfill is to raise `migrations.lockTimeoutMs` for that deploy, since there is no per-run flag. Retry can be a later, opt-in addition.

### 9. Low: exclude only `55P03` in `failedTypeChangeOf`

`failedTypeChangeOf` (`runner.ts:125-145`) treats every SQLSTATE outside `NOT_THE_STEPS_SQL` as the conversion's error. Add `55P03` alone, not class `55`: `55000` from `currval` used in a conversion expression is the conversion's own error.

### 10. Low: where the setting goes in the code

The marker lock is taken in two places: `executeSpaces` when policies are checked (`runner.ts:318`) and `executeOnConnection` for every space (`:195`). `executeOnConnection` is part of the SQL family's runner interface (`2-sql-family/9-family/src/core/migrations/types.ts:476`) and tests call it directly. Make one method that takes the lock and sets the limit, and call it at both places. Taking the lock again in the same transaction returns at once, and setting the limit again is harmless. It also restores the configured value at each space, after a `SET LOCAL lock_timeout` in an earlier space's own SQL.

### 11. Low: other settings and statements that interact

- A `SET LOCAL lock_timeout` in a migration's own SQL replaces the limit for the rest of that space (verified). A session-level `SET` or `RESET` there also outlives the transaction on that connection, as it does today.
- A `statement_timeout` at or below the limit fires first with `57014`, reported as `MIGRATION.EXECUTION_FAILED` from an operation and raw elsewhere. It cannot be confused with `55P03`, and `57014` also means a cancel, so leave it unmapped and document it.
- `pg`'s client-side `query_timeout` (also passed through from the connection string) gives up on the client while the server keeps waiting; the following `ROLLBACK` then queues behind the wait. Document that it is not a lock limit.
- `idle_in_transaction_session_timeout` ends the session with `25P03`, which the driver reports as a lost connection (`3-driver/src/normalize-error.ts:52-61`). Not confusable.

### 12. Low: progress output

No change needed. The runner cannot tell a lock wait from a slow statement on its one connection, and with the limit a silent wait lasts at most the limit before the error explains it.

## Poolers and drivers

Safe. `set_config(…, true)` is a plain `SELECT` inside the runner's `BEGIN … COMMIT`. In transaction mode a pooler (PgBouncer, Supavisor, Neon's PgBouncer) keeps one server connection for the whole transaction, and the setting ends with it. The runner already does the same for `lc_monetary` with a bound parameter, and `pg` uses unnamed statements, so nothing new reaches the pooler. Statement-mode pooling cannot run the runner at all, today or after. The repository's stand-in for the Prisma Postgres pooler accepts only `DateStyle`, `TimeZone` and `extra_float_digits` as startup options (`9-facade/test/pooler-startup-options.integration.test.ts`), which confirms the issue's connection-level workarounds fail there and this mechanism is the one that works. PGlite accepts the setting (verified), so the existing PGlite-based runner tests keep working.

Not verified: role-level `statement_timeout` values on hosted platforms such as Supabase. They matter only through the `57014` case in finding 11.

## Testing

Unit tests with a recording or failing driver, next to `packages/3-targets/postgres/1-target/test/errors.test.ts` and the recording-driver pattern in `2-adapter/test/migrations/runner.marker-lock.integration.test.ts`. These need no server:

- The order of statements: `lock_timeout` set to `0` with `lc_monetary`, then the marker lock, then the configured value, before the policy check and the control tables, and `'0ms'` when the config says `0`.
- A `SqlQueryError` with SQLSTATE `55P03` injected at each site in finding 2 gives `MIGRATION.LOCK_TIMEOUT` with `databaseUnchanged: true`, `failingSpace`, the operation and phase where there is one, and one `ROLLBACK`. Each case fails if its site's handling is removed.
- `failedTypeChangeOf` returns nothing for `55P03` and still returns `expressionError` for `55000`.
- Config validation rejects each bad value.

The lock wait itself needs a real Postgres server: `@prisma/dev` rejects a second connection while the first is open (`test/utils/src/exports/index.ts:38-43`), and PGlite has one session. The natural home is a new `2-adapter/test/migrations/runner.lock-timeout.real-postgres.integration.test.ts`. The CI package-test job already runs a `postgres:15` service on port 5432 (`.github/workflows/ci.yml:176-190`), and `native-enum-add-value.real-postgres.integration.test.ts` connects to it. That file skips when no server answers (`describe.runIf`); the new one should fail instead, as the MySQL and MariaDB tests now do (#31178). Cases, each able to fail:

1. A second connection runs `BEGIN; SELECT 1 FROM t;` and stays open. The runner, with a limit of 200 ms, drops a column of `t`. It fails with `MIGRATION.LOCK_TIMEOUT` well within a second, and the column is still there.
2. The control: the same with a limit of `0`. The runner is still waiting after one second, and succeeds once the second connection commits. Without this, case 1 could pass for another reason.
3. The marker lock: a second connection holds `pg_advisory_xact_lock(hashtext('prisma_8.contract.marker'))` for one second, with the runner's limit at 200 ms and its connection string setting `options=-c lock_timeout=100ms`. The runner waits and succeeds (finding 1).

On this machine those tests cannot run against the local Postgres.app, which refuses connections from agent processes; CI is where they run.
