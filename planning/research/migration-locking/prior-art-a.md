# Prior art: lock timeouts in migration tools (part A)

All sources are the tools' own repositories, read through the GitHub API on 2026-11-23 at the pinned commits below. Line numbers refer to those commits.

| Tool | Repository | Pinned commit | Version at that commit |
| --- | --- | --- | --- |
| Rails (Active Record) | rails/rails | `443726cf20ae91a5fd7b10c891b029f507016056` | 8.2.0.alpha |
| strong_migrations | ankane/strong_migrations | `33234d02c076a51983826687771d84026de6d2d8` | 2.8.0 |
| safe-pg-migrations | doctolib/safe-pg-migrations | `ab7a13bf8875933a4a99de61ff96c078935a4ab6` | 5.1.0 |
| Django | django/django | `0eae0b2584ed1e13d696ae1a5d8016a5c2dc7149` | 6.2 alpha |
| django-pg-zero-downtime-migrations | tbicr/django-pg-zero-downtime-migrations | `e79318809b92f5f734f0b72f21fa49d3bd0c72e6` | 0.20 |
| Alembic | sqlalchemy/alembic | `a10b6da895bcde34afbe4c31a14c39b8daac01ca` | 1.20.2 |
| sqitch | sqitchers/sqitch | `b08e5c8a773ee4ab5ea4ab7cf6f7a16c55d6994e` | v1.6.2 |

The Postgres error a user gets when `lock_timeout` fires is SQLSTATE `55P03` (lock_not_available) with the message `canceling statement due to lock timeout` (postgres/postgres `src/backend/tcop/postgres.c` line 3608 at `9b5d4e3331753b3399e84965093109cac8f364bf`). Each tool below wraps this error in its own way.

## 1. Rails Active Record migrations (no extra gem)

- **Limits table-lock waits by default?** No. Active Record's library code never sets `lock_timeout`. A code search of rails/rails for `lock_timeout` finds only two test files (`activerecord/test/cases/adapters/postgresql/dbconsole_test.rb`, `transaction_test.rb`), no library code.
- **How a user configures it.** Only through general connection settings, not a migration feature. The Postgres adapter's `variables:` option in `database.yml` runs `SET SESSION` on every connection. `activerecord/lib/active_record/connection_adapters/postgresql_adapter.rb` lines 49-50: "An optional hash of additional parameters that will be used in `SET SESSION key = val` calls on the connection." The user can also run `execute "SET lock_timeout ..."` inside a migration. https://github.com/rails/rails/blob/443726cf20ae91a5fd7b10c891b029f507016056/activerecord/lib/active_record/connection_adapters/postgresql_adapter.rb#L49-L50
- **Scope.** With `variables:`, per session, for every connection the app opens (not only migrations).
- **Retries.** None.
- **Error on timeout.** Postgres `55P03` is mapped to `ActiveRecord::LockWaitTimeout` (a subclass of `StatementInvalid`). `postgresql_adapter.rb` line 971 `LOCK_NOT_AVAILABLE = "55P03"`, lines 1020-1021 `LockWaitTimeout.new(message, ...)`; `activerecord/lib/active_record/errors.rb` line 606 `class LockWaitTimeout < StatementInvalid`.
- **Transactions.** Each migration runs in its own DDL transaction unless it calls `disable_ddl_transaction!` (`activerecord/lib/active_record/migration.rb` lines 759-763; line 1640 `!migration.disable_ddl_transaction && connection.supports_ddl_transactions?`).
- **Lock against two migration runs at once.** A Postgres session-level advisory lock, taken with the non-waiting `pg_try_advisory_lock`. If another process holds it, the run fails immediately with `ActiveRecord::ConcurrentMigrationError`. It never waits.
  - `migration.rb` lines 1647-1651: `got_lock = connection.get_advisory_lock(lock_id)` / `raise ConcurrentMigrationError unless got_lock`. https://github.com/rails/rails/blob/443726cf20ae91a5fd7b10c891b029f507016056/activerecord/lib/active_record/migration.rb#L1647-L1651
  - `postgresql_adapter.rb` line 566: `query_value("SELECT pg_try_advisory_lock(#{lock_id})", ...)`.
  - Message, `migration.rb` line 189: "Cannot run migrations because another migration process is currently running."
  - Lock id is `MIGRATOR_SALT * Zlib.crc32(current_database)` (lines 1663-1666), so it is per database.
  - After taking the lock it reloads the applied-migrations list (line 1652, "reload schema_migrations to be sure it wasn't changed by another process").
  - Default on; turned off with `advisory_locks: false` in `database.yml`. `abstract_adapter.rb` lines 257-259: `@config.fetch(:advisory_locks, true)`. Guide: `guides/source/configuring.md` lines 4256-4281.

## 2. strong_migrations (ankane)

- **Limits table-lock waits by default?** Not in the library: `StrongMigrations.lock_timeout` has no default (it is an `attr_accessor` that `lib/strong_migrations.rb` lines 35-44 never assign). But the install generator writes an initializer that sets it to 10 seconds, and in non-development environments the gem warns when no lock timeout is set.
  - Generator template `lib/generators/strong_migrations/templates/initializer.rb.tt`: `StrongMigrations.lock_timeout = 10.seconds` and `StrongMigrations.statement_timeout = 1.hour`. https://github.com/ankane/strong_migrations/blob/33234d02c076a51983826687771d84026de6d2d8/lib/generators/strong_migrations/templates/initializer.rb.tt
  - Warning check: `lib/strong_migrations.rb` lines 61-65, `@lock_timeout_limit = developer_env? ? false : 10`; `lib/strong_migrations/adapters/postgresql_adapter.rb` lines 35-43 run `SHOW lock_timeout` and warn "[strong_migrations] DANGER: No lock timeout set" or "Lock timeout is longer than 10 seconds". It only warns; it does not stop the migration.
  - README "Migration Timeouts": "It’s extremely important to set a short lock timeout for migrations." Recommends 10 seconds lock timeout and 1 hour statement timeout. https://github.com/ankane/strong_migrations/blob/33234d02c076a51983826687771d84026de6d2d8/README.md#migration-timeouts
- **How a user configures it.** Ruby initializer (`StrongMigrations.lock_timeout`, `statement_timeout`, `lock_timeout_retries`, `lock_timeout_retry_delay`). README also offers setting it on the database role: `ALTER ROLE myuser SET lock_timeout = '10s';`, and says that is required behind PgBouncer in transaction mode.
- **Scope.** A plain session-level `SET` (not `SET LOCAL`), issued once per migration, before its first schema method. `postgresql_adapter.rb` line 181: `select_all("SET #{setting} TO #{connection.quote(timeout)}")`; `checker.rb` lines 192-203 (`set_timeouts`, guarded by `@timeouts_set`). Because the `SET` usually runs inside the migration's DDL transaction, a rollback undoes it; the migrator re-applies it before a retry (`migrator.rb` comment: "failed transaction reverts timeout, so need to re-apply"). Values under 1 ms are rounded up so they never become 0 (line 179).
- **Retries.** Off by default: `lib/strong_migrations.rb` line 37 `self.lock_timeout_retries = 0`, line 38 `self.lock_timeout_retry_delay = 10 # seconds`. README marks it "experimental". Fixed delay, no backoff, logs "Lock timeout. Retrying in N seconds..." (`checker.rb` lines 132-146).
  - Outside a transaction (migration with `disable_ddl_transaction!`): the single schema method is retried (`checker.rb` lines 107-112, `retry_lock_timeouts?` lines 251-257 requires `!in_transaction?`). A source comment admits methods that issue several statements are not handled: "lock timeout after first statement will cause retry to fail".
  - Inside the DDL transaction: the whole migration is rerun (`lib/strong_migrations/migrator.rb` lines 3-22, "retry migration since the entire transaction needs to be rerun"), and not if something was already committed (`check_committed: true`, `@committed`). README: "If it happens inside the DDL transaction, the entire migration is retried (only applicable to Postgres)". https://github.com/ankane/strong_migrations/blob/33234d02c076a51983826687771d84026de6d2d8/lib/strong_migrations/migrator.rb
- **Error on timeout.** Rails' `ActiveRecord::LockWaitTimeout` is re-raised after the last retry (`checker.rb` line 144 `raise e`).
- **Lock against two migration runs at once.** strong_migrations adds nothing; no file under `lib/` mentions "advisory". It relies on Rails' fail-at-once advisory lock (section 1).

## 3. safe-pg-migrations (Doctolib)

- **Limits table-lock waits by default?** Yes. Default lock timeout is 4.95 seconds: `lock_timeout` defaults to `nil`, and then `safe_timeout` (5 s) times 0.99 is used, so the lock timeout fires before the 5 s statement timeout.
  - `lib/safe-pg-migrations/configuration.rb` line 30 `self.lock_timeout = nil`, line 34 `self.safe_timeout = 5.seconds`, line 81 `pg_duration safe_timeout * 0.99`. https://github.com/doctolib/safe-pg-migrations/blob/ab7a13bf8875933a4a99de61ff96c078935a4ab6/lib/safe-pg-migrations/configuration.rb#L30-L81
  - README says "sets a short lock timeout (default to 5 seconds)".
  - Setting it to 0 raises: "Setting lock timeout to 0 disables the lock timeout and is dangerous" (configuration.rb `lock_timeout=`). `lock_timeout` must also be below `safe_timeout` and at most `max_lock_timeout_for_retry` (default 1 second, line 31).
  - `CREATE INDEX CONCURRENTLY` / `DROP INDEX CONCURRENTLY` run with both timeouts set to 0 (`plugins/statement_insurer.rb` lines 60 and 67, `without_timeout`; README line 204).
- **How a user configures it.** Ruby initializer: `SafePgMigrations.config.lock_timeout`, `safe_timeout`, `max_tries`, `retry_delay`, `increase_lock_timeout_on_retry`, `max_lock_timeout_for_retry`, `blocking_activity_logger_*`. README "Configuration" section.
- **Scope.** Session-level `SET`, applied around the whole migration and restored afterwards. `base.rb` line 48 `connection.with_setting :lock_timeout, SafePgMigrations.config.pg_lock_timeout do`; `helpers/session_setting_management.rb` line 8 `execute("SET #{key} TO #{quote(value)}")`, line 13 restores the old value from `SHOW`.
- **Transactions.** It forces every migration out of the DDL transaction: `base.rb` lines 113-117 override `disable_ddl_transaction` to return `true`. README: "In order to be able to retry statements that have failed because of a lock timeout, we have to be outside a transaction."
- **Retries.** On by default, per statement, for a fixed list of methods: `add_check_constraint`, `add_column`, `add_foreign_key`, `change_column_default`, `change_column_null`, `create_table`, `remove_column`, `remove_foreign_key`, `drop_table` (`helpers/statements_helper.rb`). Up to 5 tries (`max_tries = 5`, configuration.rb line 32) with a fixed 1-minute delay (`retry_delay = 1.minute`, line 33). Never retried inside a transaction: `plugins/statement_retrier.rb` line 24 `raise e if transaction_open? || number_of_retries >= SafePgMigrations.config.max_tries`. Optional linear increase of the lock timeout per retry (`increase_lock_timeout_on_retry`, default false), step `(max_lock_timeout_for_retry - lock_timeout) / (max_tries - 1)`. https://github.com/doctolib/safe-pg-migrations/blob/ab7a13bf8875933a4a99de61ff96c078935a4ab6/lib/safe-pg-migrations/plugins/statement_retrier.rb
- **Blocking-activity logging.** For each retriable statement a background thread, on a second connection, sleeps until `timeout - blocking_activity_logger_margin` (margin default 1 s) and then queries which sessions block the migration's backend pid. On `LockWaitTimeout` it logs "Lock timeout." and the blocking queries (raw SQL by default, or only lock info when `blocking_activity_logger_verbose = false`). For concurrent index builds it logs blocking queries every `retry_delay`. `plugins/blocking_activity_logger.rb` lines 12-80, 86-88.
- **Error on timeout.** `ActiveRecord::LockWaitTimeout`, re-raised after the last try.
- **Lock against two migration runs at once.** Nothing of its own (no advisory lock code under `lib/`); relies on Rails' fail-at-once advisory lock.

## 4. Django migrations (and django-pg-zero-downtime-migrations)

### Django itself

- **Limits table-lock waits by default?** No. No library or docs file mentions `lock_timeout`: code search of django/django for `lock_timeout` returns nothing, and `django/db/migrations/executor.py`, `recorder.py`, `django/core/management/commands/migrate.py`, `django/db/backends/postgresql/schema.py` contain no lock or timeout handling.
- **How a user configures it.** Not a Django feature. A user can run `RunSQL("SET lock_timeout ...")` in a migration or pass Postgres options through `DATABASES[...]["OPTIONS"]` to libpq. UNVERIFIED: I did not find a Django docs page that recommends either for migrations.
- **Scope / retries / error.** Not applicable. No retries. The user would see the raw driver error wrapped as `django.db.utils.OperationalError` (UNVERIFIED: not traced in source for `55P03` specifically).
- **Transactions.** On Postgres each migration runs in one transaction unless `atomic = False`. `docs/topics/migrations.txt` "Transactions": "all migration operations will run inside a single transaction by default." https://github.com/django/django/blob/0eae0b2584ed1e13d696ae1a5d8016a5c2dc7149/docs/topics/migrations.txt
- **Lock against two migration runs at once.** None. No advisory lock or table lock in `executor.py`, `recorder.py` or `migrate.py`; code search for "advisory" finds only old release notes. Two concurrent `migrate` runs are not prevented by Django.

### django-pg-zero-downtime-migrations (third party, tbicr)

- **Limits table-lock waits by default?** No. `ZERO_DOWNTIME_MIGRATIONS_LOCK_TIMEOUT` and `ZERO_DOWNTIME_MIGRATIONS_STATEMENT_TIMEOUT` default to `None`, which means "current postgres setting used". README lines 68-77; `django_zero_downtime_migrations/backends/postgres/schema.py` line 575 `getattr(settings, "ZERO_DOWNTIME_MIGRATIONS_LOCK_TIMEOUT", None)`. The README's example settings use `'2s'`. https://github.com/tbicr/django-pg-zero-downtime-migrations/blob/e79318809b92f5f734f0b72f21fa49d3bd0c72e6/README.md
- **How a user configures it.** Django settings, plus switching the database `ENGINE` to the package's backend.
- **Scope.** Per statement, only for statements the backend marks as taking `ACCESS EXCLUSIVE` locks. Before such a statement it reads the current values from `pg_settings`, runs session-level `SET lock_timeout TO '...'`, runs the statement, then sets the old values back (`schema.py` lines 214-217 and 651-669). The restore is not in a `finally`, so after a failure the session keeps the migration's value until the transaction rolls back. Optional `ZERO_DOWNTIME_MIGRATIONS_FLEXIBLE_STATEMENT_TIMEOUT` sets `statement_timeout` to 0 for `SHARE UPDATE EXCLUSIVE` statements such as concurrent index builds.
- **Retries.** None (no retry code in `schema.py`).
- **Error on timeout.** The Postgres error, surfaced by Django.
- **Lock against two migration runs at once.** None.

## 5. Alembic

- **Limits table-lock waits by default?** No. No `lock_timeout`, `statement_timeout` or advisory lock in Alembic's runtime or Postgres DDL code (`alembic/runtime/*.py`, `alembic/ddl/postgresql.py`, `alembic/command.py`; the only "lock" hits are `autocommit_block`), and none in the docs (`docs/build/*.rst`). Code search for `lock_timeout` and `pg_advisory` in sqlalchemy/alembic returns nothing.
- **How a user configures it.** By hand in `env.py` or with `op.execute("SET lock_timeout ...")` in a revision. UNVERIFIED: no Alembic docs or cookbook page describes this.
- **Scope / retries / error.** Not applicable. No retries. The user sees the DBAPI error wrapped by SQLAlchemy (UNVERIFIED for the exact class).
- **Lock against two migration runs at once.** None built in. The author (Mike Bayer, `zzzeek`) said so in issue #633 and suggested taking a table lock in `env.py`: "there is no built-in isolation configuration that would guarantee to 'block' transactions", with an example `LOCK TABLE alembic_version IN ACCESS EXCLUSIVE MODE` inside `context.begin_transaction()`. That lock would wait without limit (Postgres default). https://github.com/sqlalchemy/alembic/issues/633

## 6. sqitch

- **Limits table-lock waits by default?** No. sqitch runs change scripts through `psql` with `ON_ERROR_STOP=1` (`lib/App/Sqitch/Engine/pg.pm` line 95) and sets no `lock_timeout` or `statement_timeout`; `pg.pm` contains neither word. Users put `SET lock_timeout` in their own change scripts if they want it (UNVERIFIED: no sqitch doc found recommending this).
- **The `--lock-timeout` option is not about table locks.** It limits how long sqitch waits for its own advisory lock that stops two sqitch instances working on the same target. `lib/sqitch-deploy.pod` lines 102-109: "This lock prevents other instances of Sqitch from working on the target at the same time, but prevents no other database activity. Defaults to 60." https://github.com/sqitchers/sqitch/blob/b08e5c8a773ee4ab5ea4ab7cf6f7a16c55d6994e/lib/sqitch-deploy.pod
- **Lock against two runs at once: how it works.**
  - Default 60 seconds: `lib/App/Sqitch/Engine.pm` line 16 `use constant default_lock_timeout => 60;`.
  - First a non-waiting try: `pg.pm` line 292 `SELECT pg_try_advisory_lock(75474063)` (a fixed key, session level).
  - If that fails, it prints "Blocked by another instance of Sqitch working on {dest}; waiting {secs} seconds..." and sends an asynchronous `SELECT pg_advisory_lock(75474063)`, polling for the result with exponential backoff (10 ms initial, 10 s max delay) until `lock_timeout` seconds pass; then it cancels the query (`pg_cancel`). `Engine.pm` lines 1115-1158, `pg.pm` lines 298-319. https://github.com/sqitchers/sqitch/blob/b08e5c8a773ee4ab5ea4ab7cf6f7a16c55d6994e/lib/App/Sqitch/Engine/pg.pm#L288-L319
  - On timeout it exits with "Timed out waiting {secs} seconds for another instance of Sqitch to finish work on {dest}" (`Engine.pm` lines 1134-1138).
  - Configured only by the `--lock-timeout` CLI flag on `deploy`, `revert`, `rebase`, `checkout`. There is no config-file key: `lib/App/Sqitch/Command/deploy.pm` lines 87-89 copy `lock_timeout` from options only, and the documented `deploy.*` config keys are `mode`, `verify`, `variables`.
  - On YugabyteDB and other non-`postgres` providers the lock is skipped (`pg.pm` lines 290, 305).

## Unverified claims

- Django: whether any Django doc recommends `RunSQL("SET lock_timeout")` or libpq `OPTIONS` for migrations; the exact exception class for `55P03` (assumed `OperationalError`).
- Alembic: that no docs page mentions setting `lock_timeout` in `env.py` (only searched the `.rst` files at the pinned commit); the exact SQLAlchemy exception class on timeout.
- sqitch: that no sqitch doc recommends putting `SET lock_timeout` in change scripts.
