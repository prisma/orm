# Lock timeout for migration statements: prior art and guidance

Researched 2026-11-23. Tool facts come from source code or official docs at the commit named. Quotes are short and verbatim. Anything not confirmed in a primary source is marked UNVERIFIED.

## Summary table

| Tool | Default wait limit | Scope | Retries | After retries run out |
| --- | --- | --- | --- | --- |
| pgroll | 500 ms `lock_timeout` | session (`SET`) | unlimited, exponential backoff with jitter, 1 s base, 1 min cap | never runs out; only context cancellation stops it |
| Reshape | 1 s `lock_timeout` (hard-coded) | session (`SET`) | 10 attempts, 100 ms doubling to 3.2 s, plus up to 50% jitter; not inside transactions | returns the Postgres error |
| GitLab `WithLockRetries` | 100 ms to 2 s, varies per attempt | transaction (`SET LOCAL`) | 615 attempts (41-step table repeated 15 times), sleeps 50 ms to 15 s, about 45 minutes in total | migrations: raises `AttemptsExhaustedError`; direct class call: runs once more with no lock timeout |
| Braintree pg_ha_migrations | 5 s (as `statement_timeout` around `LOCK TABLE`) | per lock attempt | unlimited; sleeps 25 s after a timeout; waits first while long-running transactions hold the table | never runs out |
| gh-ost (MySQL) | 3 s (`lock_wait_timeout` for the cut-over `RENAME`) | session | `--default-retries` 60, 1 s apart (or exponential with `--cut-over-exponential-backoff`) | panics / aborts the migration |
| pt-online-schema-change (MySQL) | `lock_wait_timeout=60`, `innodb_lock_wait_timeout=1` | session (`--set-vars`) | `--tries`: 10 tries per operation, 1 s apart (0.25 s for copy_rows) | fails the operation |

## Part 1: tools

### 1. pgroll (xataio/pgroll)

Commit `448b29ba2215da4619d2eb8ee543957c6acfa95a` on `main` (latest release v0.16.3).

- Default 500 ms. `cmd/root.go` line 89: `rootCmd.PersistentFlags().Int("lock-timeout", 500, "Postgres lock timeout in milliseconds for pgroll DDL operations")`. https://github.com/xataio/pgroll/blob/448b29ba2215da4619d2eb8ee543957c6acfa95a/cmd/root.go#L89
- Docs: "`--lock-timeout`: The Postgres `lock_timeout` value to use for all `pgroll` DDL operations, specified in milliseconds (default `500`)." Also settable as `PGROLL_LOCK_TIMEOUT`; the flag wins over the variable. https://github.com/xataio/pgroll/blob/448b29ba2215da4619d2eb8ee543957c6acfa95a/docs/cli/README.md
- `--role` (default `""`): "The Postgres role to use for all `pgroll` DDL operations". Env `PGROLL_ROLE`. Same docs file.
- How it is set: session-level `SET` on connection setup, skipped when the value is 0. `pkg/roll/roll.go` line 110: `SET lock_timeout to '%dms'`; then `SET ROLE %s` if a role is given. https://github.com/xataio/pgroll/blob/448b29ba2215da4619d2eb8ee543957c6acfa95a/pkg/roll/roll.go#L109-L121
- Observation: the connection is a Go `*sql.DB` pool, and the `SET` is run through it once. `SetMaxOpenConns` appears only in a test file (`pkg/backfill/backfill_test.go`). Whether every pooled connection gets the setting is UNVERIFIED; it may only reach the first connection.
- Retries: `pkg/db/db.go` wraps `ExecContext`, `QueryContext` and `WithRetryableTransaction`. On SQLSTATE `55P03` it sleeps and retries, with no attempt limit; only context cancellation ends the loop. Constants: `maxBackoffDuration = 1 * time.Minute`, `backoffInterval = 1 * time.Second`, using `github.com/cloudflare/backoff`. Comment: "retries queries using an exponential backoff (with jitter) on lock_timeout errors." https://github.com/xataio/pgroll/blob/448b29ba2215da4619d2eb8ee543957c6acfa95a/pkg/db/db.go#L16-L105
- For a transaction, the whole transaction is rolled back and re-run (`WithRetryableTransaction`).
- Error shown: no pgroll-specific message. Retries are silent. Any other error is returned as-is. Because lock timeouts retry forever, the user never sees the `55P03` error unless the context is cancelled.
- Retry support was added in v0.6.0 (Xata release post: https://xata.io/blog/pgroll-0-6-0-update; post not read in full).

### 2. Reshape (fabianlindfors/reshape)

Commit `1c52737b3213bede6997815d4b1f59c6b9174eba`, file `src/db.rs`. https://github.com/fabianlindfors/reshape/blob/1c52737b3213bede6997815d4b1f59c6b9174eba/src/db.rs

- Default 1 s, hard-coded, not configurable: `pg.simple_query("SET lock_timeout = '1s'")` next to `// TODO: Make lock_timeout configurable`. Session scope (lines 34-48).
- The comment explains the lock queue: "it will block other queries until the lock has been acquired and released". It cites the Braintree/PayPal Medium post.
- Retries: `retry_automatically` (lines 179-223). `STARTING_WAIT_TIME: u64 = 100`, `MAX_WAIT_TIME: u64 = 3_200`, `MAX_ATTEMPTS: u32 = 10`. Wait is `min(3200, 100 * 2^(attempt-1))` ms, plus jitter of "up to half the wait time".
- What it retries: database errors only when the code is `LOCK_NOT_AVAILABLE` ("LOCK_NOT_AVAILABLE is caused by lock_timeout being exceeded"). Non-database errors such as connection errors are retried too.
- Scope of retries: only statements run directly on the connection (`DbConn::run/query/query_with_params`). Statements inside a `Transaction` are not retried (that `impl Conn for Transaction` calls the client directly).
- After 10 attempts it returns the last Postgres error. No custom message.

### 3. gh-ost (github/gh-ost), MySQL

Commit `dfb342a4b391b7593a71927976f8841c2ac33219` on `master`.

- `--cut-over-lock-timeout-seconds`, default 3: `flag.Int64("cut-over-lock-timeout-seconds", 3, "Max number of seconds to hold locks on tables while attempting to cut-over (retry attempted when lock exceeds timeout) or attempting instant DDL")`. `go/cmd/gh-ost/main.go` line 132. https://github.com/github/gh-ost/blob/dfb342a4b391b7593a71927976f8841c2ac33219/go/cmd/gh-ost/main.go#L132
- Allowed range 1 to 10 s (60 in `--move-tables` mode): `go/base/context.go` lines 710-720, "minimal timeout is 1sec", `maxTimeout := int64(10)`.
- Docs: "Maximum seconds to hold locks while attempting cut-over; a lock timeout causes a retry." https://github.com/github/gh-ost/blob/dfb342a4b391b7593a71927976f8841c2ac33219/doc/command-line-flags.md#cut-over-lock-timeout-seconds
- What it sets: session variable `lock_wait_timeout` (the MySQL metadata-lock wait). `go/logic/applier.go`:
  - `LOCK TABLES` step: `CutOverLockTimeoutSeconds * 2`, query `set /* gh-ost */ session lock_wait_timeout:=%d` (line 2417).
  - `RENAME` step: `CutOverLockTimeoutSeconds` itself, log "Setting RENAME timeout as %d seconds" (lines 2523-2524).
  - Instant DDL also uses `CutOverLockTimeoutSeconds * 2` (line 676-678).
- `--default-retries`, default 60: `flag.Int64("default-retries", 60, "Default number of retries for various operations before panicking")` (main.go line 130).
- Cut-over retry: `go/logic/migrator.go` lines 672-681 pick `retryOperationWithExponentialBackoff` when `--cut-over-exponential-backoff` is set, otherwise `retryOperation`. `retryOperation` (lines 178-211) tries up to `MaxRetries()` times with `sleepDuration := 1 * time.Second` between attempts, then sends the error to `PanicAbort`. Exponential mode waits up to `--exponential-backoff-max-interval` (default 64 s, main.go line 127).

### 4. pt-online-schema-change (Percona Toolkit), MySQL

Official docs page, version 3.7.2: https://docs.percona.com/percona-toolkit/pt-online-schema-change.html

- `--set-vars` defaults: `wait_timeout=10000 innodb_lock_wait_timeout=1 lock_wait_timeout=60`. "Variables specified on the command line override these defaults." Session scope (set on the tool's connections).
- `--tries`: "How many times to try critical operations." Default table (tries, wait seconds): `create_triggers` 10/1, `drop_triggers` 10/1, `copy_rows` 10/0.25, `swap_tables` 10/1, `update_foreign_keys` 10/1, `analyze_table` 10/1.
- It retries on: lock wait timeout (both variables), "Deadlock found", query killed, connection killed, lost connection.
- Fixed wait between tries, no backoff.

### 5. GitLab migration helpers

Source: `gitlab-org/gitlab` on `master`, commit `a30ded5fee13958e378469dbab18d7d558369067`.

`lib/gitlab/database/with_lock_retries.rb`: https://gitlab.com/gitlab-org/gitlab/-/blob/a30ded5fee13958e378469dbab18d7d558369067/lib/gitlab/database/with_lock_retries.rb

- Timing: `DEFAULT_TIMING_CONFIGURATION` is a list of `[lock_timeout, sleep]` pairs. It starts `[0.1.seconds, 0.05.seconds], # short timings, lock_timeout: 100ms, sleep after LockWaitTimeout: 50ms`. Values range from 100 ms to 2 s for `lock_timeout` and 50 ms to 15 s for the sleep. The table has 41 rows and is repeated `* 15`, so 615 attempts. By my sum, one pass of 41 rows takes about 178 s of timeouts plus sleeps, so about 45 minutes in the worst case. The code comment says "Worst case, this configuration would retry for about 40 minutes."
- How it is set: per attempt, inside a (sub)transaction: `connection.transaction(requires_new: true)` then `SET LOCAL lock_timeout TO '#{current_lock_timeout_in_ms}ms'` (lines 126-130). Transaction scope.
- Retry trigger: `rescue ActiveRecord::LockWaitTimeout` (Rails maps SQLSTATE 55P03 to this). Between attempts it sets `SET LOCAL idle_in_transaction_session_timeout TO '0'` when inside an outer transaction.
- Exhaustion: `run(raise_on_exhaustion: false)` is the class default. With `raise_on_exhaustion` it raises `AttemptsExhaustedError, 'configured attempts to obtain locks are exhausted'`. Without it, it runs the block once more with `SET LOCAL lock_timeout TO '0'` (no limit) and logs "Executing the migration without lock timeout".
- Escape hatch: env `DISABLE_LOCK_RETRIES=true` runs the block once with no retry.

Default for migrations: on, and it raises on exhaustion.

- `config/initializers/active_record_migrations.rb` calls `Gitlab::Database::Migrations::LockRetryMixin.patch!`.
- `lib/gitlab/database/migrations/lock_retry_mixin.rb`: Rails' `ddl_transaction` is replaced, so every migration that uses a transaction runs inside `WithLockRetries.new(...).run(raise_on_exhaustion: true, &block)`. The whole migration transaction is retried. https://gitlab.com/gitlab-org/gitlab/-/blob/a30ded5fee13958e378469dbab18d7d558369067/lib/gitlab/database/migrations/lock_retry_mixin.rb
- The `with_lock_retries` helper for non-transactional migrations (`lib/gitlab/database/migrations/lock_retries_helpers.rb`) defaults to `raise_on_exhaustion = !!kwargs.fetch(:raise_on_exhaustion, true)`.
- I found no `enable_lock_retries!` method on current master. It seems to be an older opt-in that the always-on patch replaced (UNVERIFIED).

Docs (Migration Style Guide, "Retry mechanism when acquiring database locks"): https://docs.gitlab.com/development/migration_style_guide/

- "lock-retry mechanism is enabled by default (unless `disable_ddl_transaction!`)."
- Lock queue: "it may also block other queries on the `users` table once it has been enqueued."
- The docs are behind the code. They say "Iterate 50 times", "maximum of 50 times over 40 minutes", and "After the 50th retry, the block is executed without `lock_timeout`". The code has 615 attempts and raises on exhaustion for migrations.

## Part 2: authoritative guidance

### 6. PostgreSQL official docs and source

`lock_timeout`. Source: https://www.postgresql.org/docs/current/runtime-config-client.html#GUC-LOCK-TIMEOUT (the "current" docs, version 19).

- What it does: "Abort any statement that waits longer than the specified amount of time while attempting to acquire a lock on a table, index, row, or other database object."
- Each lock attempt is timed on its own: "The time limit applies separately to each lock acquisition attempt." So one statement that needs several locks can wait longer than the limit in total.
- Explicit and implicit locks are both covered: "applies both to explicit locking requests ... and to implicitly-acquired locks."
- Units and default: "If this value is specified without units, it is taken as milliseconds. A value of zero (the default) disables the timeout."
- Relation to `statement_timeout`: "Unlike `statement_timeout`, this timeout can only occur while waiting for locks." Also: "it is rather pointless to set `lock_timeout` to the same or larger value" than a nonzero `statement_timeout`. The `statement_timeout` entry does not mention `lock_timeout`.
- "Setting `lock_timeout` in `postgresql.conf` is not recommended because it would affect all sessions."

Error code:

- SQLSTATE `55P03 lock_not_available`, from `src/backend/utils/errcodes.txt`. https://github.com/postgres/postgres/blob/REL_18_STABLE/src/backend/utils/errcodes.txt
- Message: `errmsg("canceling statement due to lock timeout")` with `ERRCODE_LOCK_NOT_AVAILABLE`, from `src/backend/tcop/postgres.c` around line 3441. https://github.com/postgres/postgres/blob/REL_18_STABLE/src/backend/tcop/postgres.c
- The same code is also used by `NOWAIT` failures (`SELECT ... FOR UPDATE NOWAIT`, `LOCK ... NOWAIT`). That part is UNVERIFIED here; I did not open that source line.

`ALTER TABLE` lock levels. Source: https://www.postgresql.org/docs/current/sql-altertable.html

- "An `ACCESS EXCLUSIVE` lock is acquired unless explicitly noted. When multiple subcommands are given, the lock acquired will be the strictest one required by any subcommand."
- Exceptions: `SET STATISTICS`, per-attribute options, `VALIDATE CONSTRAINT`, cluster options, some storage parameters and `ATTACH PARTITION` (on the parent) take `SHARE UPDATE EXCLUSIVE`. `ADD FOREIGN KEY` takes `SHARE ROW EXCLUSIVE` on both tables, and so does `ENABLE/DISABLE TRIGGER`.

Explicit locking. Source: https://www.postgresql.org/docs/current/explicit-locking.html

- With no timeout, waits have no limit: "a transaction seeking either a table-level or row-level lock will wait indefinitely for conflicting locks to be released."
- `ACCESS EXCLUSIVE`: "Many forms of `ALTER INDEX` and `ALTER TABLE` also acquire a lock at this level."
- This page does not say that a queued request blocks requests that arrive after it.

The lock queue (a waiting `ACCESS EXCLUSIVE` request blocks later readers):

- The best statement in the user docs is the `pg_blocking_pids` entry (https://www.postgresql.org/docs/current/functions-info.html). It says a process blocks another if it "is waiting for a lock that would conflict with the blocked process's lock request and is ahead of it in the wait queue (soft block)."
- The rule itself is in the source README `src/backend/storage/lmgr/README`, "Lock acquisition" rule 1: "A lock request is granted immediately if it does not conflict with any existing or waiting lock request". Otherwise the process "joins the lock's wait queue", normally at the end. https://github.com/postgres/postgres/blob/REL_18_STABLE/src/backend/storage/lmgr/README
- The code matches: `src/backend/storage/lmgr/lock.c` checks `conflictTab[lockmode] & lock->waitMask` (lines 774, 1093).

Setting a value for one transaction only:

- `SET LOCAL` (https://www.postgresql.org/docs/current/sql-set.html): "takes effect for only the current transaction. After `COMMIT` or `ROLLBACK`, the session-level setting takes effect again."
- Outside a transaction block, `SET LOCAL` "emits a warning and otherwise has no effect."
- A plain `SET` inside a transaction that is rolled back is undone: "the effects of the `SET` command disappear when the transaction is rolled back."
- `set_config(name, value, is_local)` (https://www.postgresql.org/docs/current/functions-admin.html): "If is_local is `true`, the new value will only apply during the current transaction."

Advisory locks and `lock_timeout`:

- The docs never say so directly. The advisory-lock functions page says only "waiting if necessary" for `pg_advisory_lock` and `pg_advisory_xact_lock`, and does not mention `lock_timeout`.
- The source shows it does apply. `pg_advisory_xact_lock_int8` calls `LockAcquire(&tag, ExclusiveLock, false, false)` (`src/backend/utils/adt/lockfuncs.c` line 656). That is the same lock manager as table locks. When `ProcSleep` waits, it starts the timer: `if (LockTimeout > 0)` ... `timeouts[1].id = LOCK_TIMEOUT` (`src/backend/storage/lmgr/proc.c` lines 1388-1399, REL_18_STABLE).
- This fits the docs' wording that `lock_timeout` covers "other database object" and "implicitly-acquired locks".
- So by the source, `lock_timeout` limits waits in `pg_advisory_lock` and `pg_advisory_xact_lock`, and a timeout raises 55P03. I did not run a test to confirm this.

### 7. MySQL official docs (8.4)

`lock_wait_timeout`. Source: https://dev.mysql.com/doc/refman/8.4/en/server-system-variables.html#sysvar_lock_wait_timeout

- Global and session scope. Default `31536000`, minimum 1, maximum 31536000, unit seconds.
- "This variable specifies the timeout in seconds for attempts to acquire metadata locks." Range text: "1 to 31536000 (1 year)".
- Covers "DML and DDL operations on tables, views, stored procedures, and stored functions", plus `LOCK TABLES`, `FLUSH TABLES WITH READ LOCK` and `HANDLER`.
- "The timeout value applies separately for each metadata lock attempt." On timeout `ER_LOCK_WAIT_TIMEOUT` is reported.

`innodb_lock_wait_timeout`. Source: https://dev.mysql.com/doc/refman/8.4/en/innodb-parameters.html#sysvar_innodb_lock_wait_timeout

- Global and session scope. Default `50`, minimum 1, maximum 1073741824 seconds.
- It is the time a transaction "waits for a row lock before giving up". Error: `ERROR 1205 (HY000): Lock wait timeout exceeded; try restarting transaction`.
- Only the current statement is rolled back, not the whole transaction, unless `--innodb-rollback-on-timeout` is set.
- "this timeout does not apply to waits for table locks."

`GET_LOCK(str, timeout)`. Source: https://dev.mysql.com/doc/refman/8.4/en/locking-functions.html

- "using a timeout of _timeout_ seconds. A negative _timeout_ value means infinite timeout."
- Returns `1` on success, `0` "if the attempt timed out", `NULL` on error.

### 8. Advice from experienced operators

PostgresAI, Nikolay Samokhvalov, 2021-09-23, "Zero-downtime Postgres schema migrations need this: lock_timeout and retries". https://postgres.ai/blog/20210923-zero-downtime-postgres-schema-migrations-lock-timeout-and-retries

- Value: low; the examples use `50ms`.
- Retries: yes, with exponential backoff, jitter and a cap. The example uses a 10 ms base and a 60 s cap; a revised example makes 30 attempts.
- Prefers retrying the whole transaction over savepoints, because savepoints cause subtransaction overhead.
- Quote: "Use low `lock_timeout` values and retries to deploy schema changes gracefully."

Citus Data (now Microsoft), Marco Slot, 2018-02-22, "When Postgres blocks: 7 tips for dealing with locks". https://www.citusdata.com/blog/2018/02/22/seven-tips-for-dealing-with-postgres-locks/

- Value: `SET lock_timeout TO '2s'` before DDL.
- Retries: by hand ("try again later"); no automatic loop.
- Describes the queue: "queries that start after it will be blocked behind it."

GoCardless, Chris Sinjakli (last edited 2024-06), "Zero-downtime Postgres migrations - the hard parts". https://gocardless.com/blog/zero-downtime-postgres-migrations-the-hard-parts/

- Value: no number given.
- Retries: none; abort the deploy instead. "It's better to abort a deploy than take your application down."
- Quote: "Set `lock_timeout` in your migration scripts to a pause your app can tolerate."
- Queue: "Any locks that conflict with the queued lock will queue up behind it."

Braintree:

- "Safe Operations For High Volume PostgreSQL", Paul Gross, 2014-05-14 (https://pgrs.net/2014/05/14/safe-operations-for-high-volume-postgresql/): does not mention `lock_timeout` or retries.
- "PostgreSQL at Scale: Database Schema Changes Without Downtime" (https://medium.com/braintree-product-technology/postgresql-at-scale-database-schema-changes-without-downtime-20d3749ed680): Medium returned HTTP 403, so its content is UNVERIFIED.
- Braintree's open-source gem `braintree/pg_ha_migrations` (commit `399cedbf6b8323361d6038b174d4a34d8b00d497`) shows their practice in code:
  - `LOCK_TIMEOUT_SECONDS = 5` and `LOCK_FAILURE_RETRY_DELAY_MULTLIPLIER = 5` (`lib/pg_ha_migrations.rb` lines 35-36).
  - `safely_acquire_lock_for_table` first waits while transactions older than 5 s use the table. It then runs `LOCK ... IN ... MODE` under a 5 s `statement_timeout`, not `lock_timeout`. The code comment: "A lock timeout would apply to each individual table in the query".
  - On a lock or statement timeout it sleeps 25 s "to allow potentially queued up queries to finish" and tries again, with no attempt limit (`lib/pg_ha_migrations/safe_statements.rb` lines 710-770).
  - https://github.com/braintree/pg_ha_migrations/blob/399cedbf6b8323361d6038b174d4a34d8b00d497/lib/pg_ha_migrations/safe_statements.rb

Xata (pgroll authors), "Schema changes and the Postgres lock queue" (Andrew Farries, according to search results; date not shown). https://xata.io/blog/migrations-and-exclusive-locks

- Value: "values of less than 2 seconds are common"; the example uses 1000 ms.
- Retries: yes; pgroll retries with exponential backoff.
- Also: "Postgres does not provide any mechanism by which such statements can be automatically retried." Describes the lock queue.

Christophe Pettus (PGX), 2026-08-20, "All your GUCs in a row: lock_timeout". https://thebuild.com/blog/all-your-gucs-in-a-row-lock_timeout/

- Value: 1 to 3 s for DDL, "the conventional range".
- Retries: yes; the tool catches the error, waits and tries again, and a person investigates if it keeps failing.
- Set it for the migration role or tool, not globally.
- Use `0` or minutes before `CREATE INDEX CONCURRENTLY`, because a cancelled build leaves an invalid index.

Not found:

- pganalyze: no article about `lock_timeout` and retries for migrations. The closest is https://pganalyze.com/blog/5mins-postgres-migrations-avoid-deadlocks (not read).
- 2ndQuadrant/EDB: no blog post found. A PGDay Lowlands 2025 talk by a former EDB/2ndQuadrant engineer ("Anatomy of Table-Level Locks in PostgreSQL") says to use `lock_timeout` for DDL and retry. This comes only from a search summary, so it is UNVERIFIED.

## Unverified claims

1. pgroll: does the session `SET lock_timeout` reach every connection in its `*sql.DB` pool, or only the first one?
2. GitLab: was `enable_lock_retries!` an older opt-in that is now gone? It is not on master.
3. Postgres: does `NOWAIT` also use SQLSTATE 55P03? (I believe so, but did not open the source line.)
4. Postgres: `lock_timeout` applying to advisory locks is shown by the source code, not by the docs, and was not tested.
5. The content of Braintree's Medium post "PostgreSQL at Scale" (HTTP 403).
6. The author and date of the Xata lock-queue post.
7. The content of the PGDay Lowlands 2025 (EDB/2ndQuadrant) talk.
8. The pgroll v0.6.0 retry release note (search result only; the facts above come from source).
