# Prior art: how migration tools limit lock waits on Postgres (Flyway, Liquibase, Atlas, golang-migrate, goose)

Researched 2026-11-23 from each tool's source on GitHub and its official docs. Pinned commits:

- Flyway: `flyway/flyway@106acda188f75d033976f0eb41025de376667122` (main)
- Liquibase: release tag `v5.0.4` (latest release, 2026-08-20), plus `main@d0e1304f5f31be5df0bdd25f42cf195aad521fb1` for one unreleased feature
- Atlas: `ariga/atlas@e933d0b70620e67e8e0972e47f2c03a1dc38d333` (master, open-source CLI)
- golang-migrate: `golang-migrate/migrate@a746b101346e08a053e579a1a9259b79ecd8a9fd` (master)
- goose: `pressly/goose@ded3331f49ba36e8986082b8b74918571d420d0e` (main)

Headline: none of the five tools sets Postgres `lock_timeout` on migration statements by default, and none retries a statement after a lock timeout. Every one of them does bound (or can bound) the wait for its own "only one migration run at a time" lock. Atlas is the only one whose docs tell users to set `lock_timeout` for statements, through a paid feature (migration hooks) and a paid lint rule.

A code search for `lock_timeout` in each repository (GitHub code search, 2026-11-23) found: Flyway, no Postgres hits; Liquibase, only an Oracle-specific setting; Atlas, only the project-file key for its own migration lock and agent-skill docs; goose and golang-migrate, nothing.

## 1. Flyway (Redgate)

- **Limits table-lock waits for migration statements by default?** No. The Postgres module issues no `SET lock_timeout`; the only Postgres-specific setting is `transactional.lock`. Source: `documentation/Reference/Configuration/Flyway Namespace/Flyway PostgreSQL Namespace.md` lists one setting, `transactional.lock`. https://github.com/flyway/flyway/blob/106acda188f75d033976f0eb41025de376667122/documentation/Reference/Configuration/Flyway%20Namespace/Flyway%20PostgreSQL%20Namespace.md
- **How a user could configure one:** no dedicated setting. A user can put `SET lock_timeout` in the migration script, or in connection setup SQL: `initSql` (deprecated) runs "immediately after a database connection has been established"; the docs point to an `afterConnect` callback instead. https://github.com/flyway/flyway/blob/106acda188f75d033976f0eb41025de376667122/documentation/Reference/Configuration/Environments%20Namespace/Environment%20Init%20SQL%20Setting.md . Using initSql for `lock_timeout` specifically is not documented by Flyway (my inference, not a Flyway claim).
- **Per-script config:** `V2__my_script.sql.conf` beside the migration; overridable settings are `placeholderReplacement`, `executeInTransaction`, `encoding` (plus Teams-only `shouldExecute`). No lock or timeout setting. Quote: "a migration file `V2__my_script.sql` would have a script configuration file `V2__my_script.sql.conf`". https://github.com/flyway/flyway/blob/106acda188f75d033976f0eb41025de376667122/documentation/Reference/Script%20Configuration.md
- **Scope:** not applicable (no limit).
- **Retry after a lock timeout:** none for migration statements. UNVERIFIED: the exact text Flyway wraps around a failing statement's SQL error.
- **Error on timeout:** not applicable; if the user sets `lock_timeout` themselves, Postgres's own error propagates (wrapper text UNVERIFIED).
- **Concurrency lock (two runs at once):**
  - Postgres advisory lock, not a lock table. `PostgreSQLConnection.lock()` returns `new PostgreSQLAdvisoryLockTemplate(...)`. https://github.com/flyway/flyway/blob/106acda188f75d033976f0eb41025de376667122/flyway-database/flyway-database-postgresql/src/main/java/org/flywaydb/database/postgresql/PostgreSQLConnection.java
  - It never blocks inside Postgres: it polls `pg_try_advisory_xact_lock` (default) or `pg_try_advisory_lock`. Code: `"SELECT pg_try_advisory_xact_lock(" + lockNum + ")"`. https://github.com/flyway/flyway/blob/106acda188f75d033976f0eb41025de376667122/flyway-database/flyway-database-postgresql/src/main/java/org/flywaydb/database/postgresql/PostgreSQLAdvisoryLockTemplate.java
  - `flyway.postgresql.transactional.lock`, default `true`: transaction-level advisory lock; `false` uses a session-level lock, which the docs say is needed for `CREATE INDEX CONCURRENTLY`. Quote: "If false, session-level locks will be used instead." Configurable on the command line (`-postgresql.transactional.lock=false`), TOML, `.conf`, env var `FLYWAY_POSTGRESQL_TRANSACTIONAL_LOCK`, API, Gradle, Maven. https://github.com/flyway/flyway/blob/106acda188f75d033976f0eb41025de376667122/documentation/Reference/Configuration/Flyway%20Namespace/Flyway%20PostgreSQL%20Namespace/Flyway%20PostgreSQL%20Transactional%20Lock%20Setting.md
  - `flyway.lockRetryCount`, default `50`, retried at 1 s intervals, so about 50 s in total; `-1` retries forever. Docs: "A value of -1 indicates that Flyway should keep retrying indefinitely." Env var `FLYWAY_LOCK_RETRY_COUNT`. https://github.com/flyway/flyway/blob/106acda188f75d033976f0eb41025de376667122/documentation/Reference/Configuration/Flyway%20Namespace/Flyway%20Lock%20Retry%20Count%20Setting.md
  - Code confirms: `private static int numberOfRetries = 50;`, `unlimitedRetries = (retries < 0);`, `nextWaitInMilliseconds() { return 1000; }` (fixed delay, no backoff). https://github.com/flyway/flyway/blob/106acda188f75d033976f0eb41025de376667122/flyway-core/src/main/java/org/flywaydb/core/internal/strategy/RetryStrategy.java
  - Error after retries: "Number of retries exceeded while attempting to acquire PostgreSQL advisory lock. Configure the number of retries with the 'lockRetryCount' configuration option: <link>" (PostgreSQLAdvisoryLockTemplate.java, link above).

## 2. Liquibase

- **Limits table-lock waits for changes by default?** No, not on Postgres. `PostgresDatabase.java` (v5.0.4) contains no timeout or lock settings. https://github.com/liquibase/liquibase/blob/v5.0.4/liquibase-standard/src/main/java/liquibase/database/core/PostgresDatabase.java
- **The only DDL lock-wait setting is Oracle-only:** `ddlLockTimeout` (aliases `ddl_lock_timeout`), no default. Description: "This applies only to Oracle databases." https://github.com/liquibase/liquibase/blob/v5.0.4/liquibase-standard/src/main/java/liquibase/GlobalConfiguration.java . When set, Oracle runs `"ALTER SESSION SET DDL_LOCK_TIMEOUT=" + timeoutValue` (session scope). https://github.com/liquibase/liquibase/blob/v5.0.4/liquibase-standard/src/main/java/liquibase/database/core/OracleDatabase.java
- **How a Postgres user configures it:** no Liquibase setting; they write `SET lock_timeout` themselves in a `sql` change (my inference; not a documented Liquibase recommendation, UNVERIFIED as guidance).
- **Scope / retries / error:** not applicable on Postgres. No retry of a failed change found in source (UNVERIFIED as an exhaustive claim).
- **Concurrency lock (two runs at once):**
  - Default: the `DATABASECHANGELOGLOCK` table row (`StandardLockService`).
  - `changelogLockWaitTimeInMinutes`, default `5`: "Number of minutes to wait for the changelog lock to be available before giving up". `changelogLockPollRate`, default `10` (seconds): "Number of seconds wait between checks to the changelog lock when it is locked". GlobalConfiguration.java at v5.0.4, lines 86-95 (link above). Configured as Liquibase properties (aliases `liquibase.changeLogLockWaitTimeInMinutes`, `liquibase.changeLogLockPollRate`).
  - Behaviour: polls at a fixed interval until the deadline, printing "Waiting for changelog lock....", then fails with `"Could not acquire change log lock.  Currently locked by " + lockedBy`. https://github.com/liquibase/liquibase/blob/v5.0.4/liquibase-standard/src/main/java/liquibase/lockservice/StandardLockService.java
  - A lock row left by a killed process is never cleared automatically: later runs wait the full 5 minutes and fail (SessionLockService javadoc on main says every later run fails "until releaseLocks"). https://github.com/liquibase/liquibase/blob/d0e1304f5f31be5df0bdd25f42cf195aad521fb1/liquibase-standard/src/main/java/liquibase/lockservice/SessionLockService.java
  - Unreleased (merged to main 2026-10-21 in liquibase/liquibase#7795, not in v5.0.4): `useSessionLock`, default `false`, uses `pg_try_advisory_lock(?, ?)` with the same wait time and poll rate. https://github.com/liquibase/liquibase/blob/d0e1304f5f31be5df0bdd25f42cf195aad521fb1/liquibase-standard/src/main/java/liquibase/lockservice/PostgreSQLSessionLockService.java

## 3. Atlas (ariga.io)

- **Limits table-lock waits for migration statements by default?** No. The open-source CLI issues no `SET lock_timeout`; `lock_timeout` in the source is only the project-file key for its own migration lock (`LockTimeout string \`spec:"lock_timeout"\``). https://github.com/ariga/atlas/blob/e933d0b70620e67e8e0972e47f2c03a1dc38d333/cmd/atlas/internal/cmdapi/project.go
- **`--lock-timeout` covers only Atlas's own advisory lock, default 10 s.** `set.DurationVar(target, flagLockTimeout, 10*time.Second, "set how long to wait for the database lock")`. https://github.com/ariga/atlas/blob/e933d0b70620e67e8e0972e47f2c03a1dc38d333/cmd/atlas/internal/cmdapi/cmdapi.go . Used by `migrate apply` (`client.Driver.Lock(ctx, applyLockValue, flags.lockTimeout)`) and `migrate diff` (dev database). `migrate set` passes timeout `0`. https://github.com/ariga/atlas/blob/e933d0b70620e67e8e0972e47f2c03a1dc38d333/cmd/atlas/internal/cmdapi/migrate.go . `schema apply` declares the flag, but in the open-source source I found no use of it (UNVERIFIED what the released binary does with it).
- **Statement-level limit, how configured:** docs recommend migration hooks (Atlas Pro): "commonly used to configure session-level settings such as `statement_timeout` or `lock_timeout`". Example `hook "sql" "timeout" { transaction { after_begin = ["SET statement_timeout TO '50ms'"] } }` in `atlas.hcl`. https://atlasgo.io/versioned/apply#migration-hooks . The user can also write `SET lock_timeout` in the migration file.
- **Scope:** hooks run "inside the migration connection and transaction" (`after_begin`), so per transaction; with the default `--tx-mode file` that is per migration file. Default transaction mode: "Atlas creates one transaction per migration file". Options `file` (default), `all`, `none`. https://atlasgo.io/versioned/apply
- **`atlas:txmode` directive:** per-file override, only `none` or `file` allowed; `all` is rejected: "txmode %q is not allowed in file directive %q". `txmodeFor()` in migrate.go (link above).
- **Lint analyzers (Atlas Pro):** PG1xx and PG3xx flag locking or rewriting changes, e.g. PG101 "Missing the `CONCURRENTLY` in index creation", PG104 `PRIMARY KEY` creation takes `ACCESS EXCLUSIVE`, PG301 type change that rewrites the table, PG305 `CHECK` full scan, PG306 `FOREIGN KEY` scan that blocks writes, PG312. There is no built-in `lock_timeout` check; the docs' statement-rules example defines a custom rule `ddl-without-lock-timeout` with message "set lock_timeout before running DDL". https://atlasgo.io/lint/analyzers . The open-source repo has `sql/postgres/postgrescheck/postgrescheck.go` but not the PG3xx checks (they ship in the closed Pro build; UNVERIFIED beyond the docs).
- **Retry after a statement lock timeout:** none. With `--tx-mode none`, a rerun resumes at the failed statement: Atlas "on another migration attempt will continue with the failed statement" (https://atlasgo.io/versioned/apply). That is a manual rerun, not an automatic retry.
- **Error on statement timeout:** Postgres's own error; Atlas's wrapper text UNVERIFIED.
- **Concurrency lock (two runs at once):**
  - Postgres advisory lock, polled with `pg_try_advisory_lock`, exponential backoff with jitter from 25 ms up to 1-2 s, until the timeout: comment `// 25ms~50ms, 50ms~100ms, ..., 800ms~1.6s, 1s~2s.`; then returns `schema.ErrLocked`. https://github.com/ariga/atlas/blob/e933d0b70620e67e8e0972e47f2c03a1dc38d333/sql/postgres/driver.go
  - Error: `acquiring database lock: sql/schema: lock is held by other session` (migrate.go wrapper plus `ErrLocked` in https://github.com/ariga/atlas/blob/e933d0b70620e67e8e0972e47f2c03a1dc38d333/sql/schema/migrate.go).
  - Configure: `--lock-timeout` flag or `migration { lock_timeout = ... }` in `atlas.hcl`; `--skip-lock` / `skip_lock = true` skips it; `lock_name` (Pro, default `atlas_migrate_execute`). Docs: "failing if the lock is not freed within the `--lock-timeout` window (`10s` by default)". https://atlasgo.io/versioned/apply

## 4. golang-migrate

- **Limits table-lock waits by default?** No. The Postgres drivers set no `lock_timeout`. There is no `x-lock-timeout` URL option in the `postgres` or `pgx/v5` drivers (the `pgx` v4 driver has `x-lock-strategy` and `x-lock-table`, not a timeout).
- **`x-statement-timeout` (milliseconds, default off):** README: "Abort any statement that takes more than the specified number of milliseconds". https://github.com/golang-migrate/migrate/blob/a746b101346e08a053e579a1a9259b79ecd8a9fd/database/postgres/README.md . It is a client-side Go context deadline around each `ExecContext`, not a server `SET statement_timeout`: `ctx, cancel = context.WithTimeout(ctx, p.config.StatementTimeout)`. A whole migration file is one `Exec` unless `x-multi-statement` is on, so scope is per migration file by default, per statement in multi-statement mode. It bounds total run time, not only lock waits. https://github.com/golang-migrate/migrate/blob/a746b101346e08a053e579a1a9259b79ecd8a9fd/database/postgres/postgres.go
- **How configured:** connection URL query parameter, e.g. `postgres://...?x-statement-timeout=5000`, or `StatementTimeout` in `WithInstance` config.
- **Retries:** none.
- **Error:** `fmt.Sprintf("migration failed: %s", pgErr.Message)` plus column and detail when Postgres supplies them (postgres.go, link above).
- **Concurrency lock (two runs at once):**
  - Postgres driver: blocking `pg_advisory_lock`, with `context.Background()`. Comment: `// This will wait indefinitely until the lock can be acquired.` (postgres.go, link above; same in `database/pgx/v5/pgx.go`).
  - Library wrapper `Migrate.LockTimeout`, `var DefaultLockTimeout = 15 * time.Second`; on expiry returns `ErrLockTimeout = errors.New("timeout: can't acquire database lock")`. Implemented as a goroutine race; the database call is not cancelled, so the blocked `pg_advisory_lock` keeps waiting in Postgres until the process exits (my reading of the code). https://github.com/golang-migrate/migrate/blob/a746b101346e08a053e579a1a9259b79ecd8a9fd/migrate.go
  - CLI flag: `-lock-timeout N  Allow N seconds to acquire database lock (default 15)`. https://github.com/golang-migrate/migrate/blob/a746b101346e08a053e579a1a9259b79ecd8a9fd/internal/cli/main.go
  - `pgx` (v4) driver `x-lock-strategy=table`: single check, fails immediately with `ErrLocked` ("can't acquire lock") if the row exists. https://github.com/golang-migrate/migrate/blob/a746b101346e08a053e579a1a9259b79ecd8a9fd/database/pgx/pgx.go

## 5. goose (pressly)

- **Limits table-lock waits by default?** No. No `lock_timeout` or `statement_timeout` anywhere in the non-test source.
- **How configured:** only by the user writing `SET lock_timeout` in the migration. The CLI `-timeout` flag ("maximum allowed duration for queries to run") is a context deadline around the whole command run: `ctx, cancel = context.WithTimeout(ctx, *timeout)` before `goose.RunWithOptionsContext`. Default `0` (off). https://github.com/pressly/goose/blob/ded3331f49ba36e8986082b8b74918571d420d0e/cmd/goose/main.go
- **`-- +goose NO TRANSACTION`:** "may be added to the top of the file to run statements outside a transaction". (cmd/goose/main.go help text, link above.)
- **Scope / retries / error:** not applicable; no statement retry.
- **Concurrency lock (two runs at once):**
  - Off by default and library-only. `provider_options.go`: "If WithSessionLocker is not called, locking is disabled." https://github.com/pressly/goose/blob/ded3331f49ba36e8986082b8b74918571d420d0e/provider_options.go . The CLI uses the older `RunWithOptionsContext` path, which has no locking (no locker references found there).
  - `lock.NewPostgresSessionLocker`: polls `pg_try_advisory_lock($1)`, default every 5 s up to 60 retries (about 5 min); unlock every 2 s up to 30 retries. Option `WithLockTimeout(period, failureThreshold uint64)`, minimum 1 each; `WithLockID`, default `4097083626`. Constant backoff via `sethvargo/go-retry`. Doc comment: "By default, the lock timeout is 300s (5min), where the lock is retried every 5 seconds". https://github.com/pressly/goose/blob/ded3331f49ba36e8986082b8b74918571d420d0e/lock/session_locker_options.go and https://github.com/pressly/goose/blob/ded3331f49ba36e8986082b8b74918571d420d0e/lock/postgres.go
  - Error after retries: the last retryable error, `failed to acquire lock` (postgres.go). Wrapper text added by the provider is UNVERIFIED.
  - Alternative `NewPostgresTableLocker` (table `goose_lock`): 30 s lease, 5 s heartbeat, lock retry every 5 s for 5 min; error `acquire lock %d after retries: %w`. https://github.com/pressly/goose/blob/ded3331f49ba36e8986082b8b74918571d420d0e/lock/internal/table/locker.go

## Unverified claims

- Flyway: the exact text it wraps around a statement's SQL error.
- Liquibase: that no retry of a failed change exists anywhere (only that none was found); that `SET lock_timeout` in a `sql` change is a recommended practice (not documented by Liquibase).
- Atlas: what `schema apply --lock-timeout` does in the released binary (declared but unused in the open-source source); the wrapper text on a statement failure; that the PG3xx checks are absent from open source beyond what the docs say (Pro).
- goose: the provider's wrapper text around `failed to acquire lock`.
- golang-migrate: that the leaked `pg_advisory_lock` keeps waiting server-side after the 15 s timeout is my reading of the code, not documented.
