# Prior art: table-lock waits and concurrency locks in JavaScript migration tools and Prisma Migrate (up to 7)

Researched 2026-11-23 from each tool's source on GitHub (pinned commits below) and its official docs. "UNVERIFIED" marks anything not confirmed in a primary source.

Summary: none of these tools sets `lock_timeout` (or any other limit) on the migration statements themselves. All of them leave it to the user to write `SET lock_timeout` in a migration or set it on the role or connection. The tools differ only in how they stop two runs from colliding.

## 1. node-pg-migrate

Pinned: `salsita/node-pg-migrate@b75e306622018bd60029f561386fc2538c4979c5` (main). Latest release v9.0.0 (2026-07-17); the lock code below is the same at tag `v9.0.0`.

- **Limits table-lock waits by default?** No. The source never issues `SET lock_timeout`. The only mention of `lock_timeout` in the repository is a docs note that a session-level `SET` in a down migration carries over into reapplication during `redo`: "including changes to the role or `lock_timeout`" ([docs/src/api.md](https://github.com/salsita/node-pg-migrate/blob/b75e306622018bd60029f561386fc2538c4979c5/docs/src/api.md)).
- **How configured:** not a feature. A user writes `pgm.sql("SET lock_timeout = ...")` in a migration (UNVERIFIED as a documented recipe; it follows only from the tool running raw SQL).
- **Scope:** not applicable.
- **Retry:** none.
- **Error on timeout:** not applicable (the Postgres error passes through).
- **Transactions:** CLI default `single-transaction: true`, so all pending migrations share one transaction; API default `singleTransaction: false`, so each migration gets its own `BEGIN`/`COMMIT` ([docs/src/cli.md](https://github.com/salsita/node-pg-migrate/blob/b75e306622018bd60029f561386fc2538c4979c5/docs/src/cli.md): "`single-transaction` | | `true`"; [src/migration.ts](https://github.com/salsita/node-pg-migrate/blob/b75e306622018bd60029f561386fc2538c4979c5/src/migration.ts) L360-L375). `pgm.noTransaction()` runs one migration outside any transaction and, in single-transaction mode, breaks the shared transaction with a `COMMIT;` before and `BEGIN;` after ([src/migrationBuilder.ts](https://github.com/salsita/node-pg-migrate/blob/b75e306622018bd60029f561386fc2538c4979c5/src/migrationBuilder.ts) L1060; src/migration.ts L367-L371).
- **Concurrency lock:** a session-level Postgres advisory lock on the migration connection, key `PG_MIGRATE_LOCK_ID = 7_241_865_325_823_964` ([src/runner.ts](https://github.com/salsita/node-pg-migrate/blob/b75e306622018bd60029f561386fc2538c4979c5/src/runner.ts) L283).
  - Default `advisoryLockMode: 'fail'`: `SELECT pg_try_advisory_lock(...)`, and if not obtained it throws at once: "Another migration is already running. Advisory lock mode is set to 'fail'." (src/runner.ts L486-L492).
  - `advisoryLockMode: 'wait'` (CLI `--advisory-lock-mode wait`, added 2026-06-08 in #1648): `SELECT pg_advisory_lock(...)`, which waits with no limit set by the tool (src/runner.ts L481-L482).
  - `--no-lock` / `noLock: true` disables the lock; `--lock-value` / `lockValue` changes the key (default `PG_MIGRATE_LOCK_ID`) ([src/cli/options.ts](https://github.com/salsita/node-pg-migrate/blob/b75e306622018bd60029f561386fc2538c4979c5/src/cli/options.ts) L304-L328). Dry runs take no lock.
  - Troubleshooting FAQ: "set `advisoryLockMode` to `'wait'`" to avoid the immediate failure ([docs/src/faq/troubleshooting.md](https://github.com/salsita/node-pg-migrate/blob/b75e306622018bd60029f561386fc2538c4979c5/docs/src/faq/troubleshooting.md) L72).
- No issue in the repository asks for `lock_timeout` (issue search for "lock_timeout" and "lock timeout" found only an unrelated one, #1628).

## 2. Knex migrations

Pinned: `knex/knex@e25d54bcb707714a17f5a5744eba5c4246bb4d1d` (master; latest release 3.3.0). Docs: `knex/documentation@9b49f59e34297c212d10005e84770a8ffb7856a0`.

- **Limits table-lock waits by default?** No. `lock_timeout` appears nowhere in `knex/knex` or `knex/documentation` (code search, empty result).
- **How configured:** not a feature; a user can run `knex.raw('SET lock_timeout ...')` inside a migration (UNVERIFIED as documented advice).
- **Scope / retry / timeout error:** not applicable.
- **Transactions:** each migration runs in a transaction by default; `disableTransactions` turns that off globally, `exports.config = { transaction: false }` per migration ([src/guide/migrations.md](https://github.com/knex/documentation/blob/9b49f59e34297c212d10005e84770a8ffb7856a0/src/guide/migrations.md) L273, L281). When no migration opts out, the whole batch runs in one wrapping transaction (`transactionForAll`, [lib/migrations/migrate/Migrator.js](https://github.com/knex/knex/blob/e25d54bcb707714a17f5a5744eba5c4246bb4d1d/lib/migrations/migrate/Migrator.js) L80-L96).
- **Concurrency lock:** a row in the table `<tableName>_lock` (default `knex_migrations_lock`) with an `is_locked` column. The lock is taken by `UPDATE ... SET is_locked = 1 WHERE is_locked = 0`, and if the row count is not 1 it throws "Migration table is already locked" wrapped in an error named `MigrationLocked` (Migrator.js L18-L21, L455-L474). The CLI then logs "Can't take lock to run migrations" and points to `knex migrate:unlock` (L547-L555). A crashed run leaves the lock set until someone runs `knex migrate:unlock` / `forceFreeMigrationsLock()` (docs L365-L375).
  - Wait or fail depends on the transaction mode (read from the code, not stated in docs):
    - Default (batch in one wrapping transaction): the `UPDATE` runs inside that transaction, so a second runner's `UPDATE` blocks on the row lock of the first runner's open transaction until it commits. No limit is set. The code expects this: "some migrations could have been done while waiting for the lock" (Migrator.js L490-L492), and re-reads the completed list.
    - Without a wrapping transaction (`disableTransactions`, any migration with `transaction: false`, or CockroachDB): the `UPDATE` runs in its own short transaction and fails at once with `MigrationLocked` if another run holds the flag.
  - The docs describe it as waiting: "If it can't, it will wait until the lock is released", and say it uses `SELECT ... FOR UPDATE` (docs L371). The current code uses `UPDATE ... WHERE is_locked = 0`, not `SELECT ... FOR UPDATE`, and fails at once in the non-wrapped case. The docs are partly out of date.
  - No configuration of the wait.

## 3. Drizzle Kit / drizzle-orm migrator

Pinned: `drizzle-team/drizzle-orm@3bcb6a27ec1f4f1602aeeb0af2f5aec61010d72d` (main, release line 0.45.4) and tag `v1.0.0-rc.6` (`f163324decffcc67b47c6f3dda43ca7bb5aaec49`, 2026-11-20).

- **Limits table-lock waits by default?** No. The Postgres migrator issues no `SET` of any timeout ([drizzle-orm/src/pg-core/dialect.ts](https://github.com/drizzle-team/drizzle-orm/blob/3bcb6a27ec1f4f1602aeeb0af2f5aec61010d72d/drizzle-orm/src/pg-core/dialect.ts) L73-L111). `MigrationConfig` has only `migrationsFolder`, `migrationsTable`, `migrationsSchema` ([drizzle-orm/src/migrator.ts](https://github.com/drizzle-team/drizzle-orm/blob/3bcb6a27ec1f4f1602aeeb0af2f5aec61010d72d/drizzle-orm/src/migrator.ts) L9-L13). The v1 rc.6 migrator (`drizzle-orm/src/up-migrations/pg-program.ts`) has no lock or timeout either (grep for lock/timeout/advisory empty).
- **How configured / scope / retry / error:** not applicable.
- **Transactions:** all pending migrations run in one transaction: `await session.transaction(async (tx) => { for await (const migration of migrations) ...` (dialect.ts L95). The v1 doc comment says the same: "in one transaction (or the driver's equivalent)" (pg-program.ts L157). `drizzle-kit migrate` calls the same `drizzle-orm/node-postgres/migrator` ([drizzle-kit/src/cli/connections.ts](https://github.com/drizzle-team/drizzle-orm/blob/3bcb6a27ec1f4f1602aeeb0af2f5aec61010d72d/drizzle-kit/src/cli/connections.ts) L188).
- **Concurrency lock:** none. The migrator reads the last applied migration before opening its transaction, with no lock (dialect.ts L88-L94).
  - Open issue [#874](https://github.com/drizzle-team/drizzle-orm/issues/874) (2023-07-10, 27 comments): "`migrate` isn't protected against simultaneous execution". Users deploying several Kubernetes pods ask for a built-in lock and cite Prisma's advisory locking. A user posted a workaround with `pg_advisory_lock` and a 10 second client timeout; maintainer AndriiSherman said on 2024-06-07 he was taking it on. Still open, and not in rc.6.
  - No issue asking for `lock_timeout` (issue search for "lock_timeout" empty).

## 4. TypeORM migrations

Pinned: `typeorm/typeorm@d5b143dd7ed659e2a1cbac044a2c78d90c0f6f8f` (master; latest release 1.1.3).

- **Limits table-lock waits by default?** No. `MigrationExecutor.ts` and the Postgres driver contain no `lock_timeout` or `statement_timeout` (grep empty; only `connectionTimeoutMillis` for connecting, [PostgresDriver.ts](https://github.com/typeorm/typeorm/blob/d5b143dd7ed659e2a1cbac044a2c78d90c0f6f8f/packages/typeorm/src/driver/postgres/PostgresDriver.ts) L1753).
- **How configured:** not a feature. Open proposal [#12669](https://github.com/typeorm/typeorm/issues/12669) (2026-07-08) asks for a `sessionParameters` option because there is no first-class way to set `statement_timeout`, `lock_timeout` and similar on new connections. Old question [#3929](https://github.com/typeorm/typeorm/issues/3929) (2019) asked how to set `lock_timeout`; closed.
- **Scope / retry / error:** not applicable.
- **Transactions:** `transaction: "all" | "none" | "each" = "all"` ([packages/typeorm/src/migration/MigrationExecutor.ts](https://github.com/typeorm/typeorm/blob/d5b143dd7ed659e2a1cbac044a2c78d90c0f6f8f/packages/typeorm/src/migration/MigrationExecutor.ts) L20-L25). Set by data source option `migrationsTransactionMode` ([BaseDataSourceOptions.ts](https://github.com/typeorm/typeorm/blob/d5b143dd7ed659e2a1cbac044a2c78d90c0f6f8f/packages/typeorm/src/data-source/BaseDataSourceOptions.ts) L58) or CLI `--transaction` / `-t` ([MigrationRunCommand.ts](https://github.com/typeorm/typeorm/blob/d5b143dd7ed659e2a1cbac044a2c78d90c0f6f8f/packages/typeorm/src/commands/MigrationRunCommand.ts) L23-L27). A migration may set `transaction = false/true` itself, except in `all` mode, where that throws `ForbiddenTransactionModeOverrideError` (MigrationExecutor.ts L267-L285).
- **Concurrency lock:** none in `MigrationExecutor.ts` (grep for "lock" empty). Open issue [#4588](https://github.com/typeorm/typeorm/issues/4588) (2019, "migration handling for multiple instances"); a contributor argued on 2020-10-07 that locking belongs in a wrapper, not the core library.

## 5. Sequelize / umzug

Pinned: `sequelize/umzug@d94dfaeb908a67cf54c8fe85bc197d36f3b2675d` (main; latest release v3.8.3). `sequelize/cli@679054aea251572ac7f6fa152f5d9eff9dbbbe9c`.

- **Limits table-lock waits by default?** No. umzug has no database code that sets timeouts, and its `src/` has no transaction handling at all (grep for "transaction" and "timeout" empty). sequelize-cli `src/` has no match for "lock", "lock_timeout" or "advisory".
- **How configured / scope / retry / error:** not applicable.
- **Concurrency lock:** none built in for databases. umzug ships an optional `FileLocker` that writes a lock file in `beforeCommand` and throws if it exists: "Can't acquire lock. ${this.lockFile} exists" ([src/file-locker.ts](https://github.com/sequelize/umzug/blob/d94dfaeb908a67cf54c8fe85bc197d36f3b2675d/src/file-locker.ts) L52-L78). It fails at once; its doc comment shows how to extend it to poll and wait. A file lock only protects runs on one machine. The README presents it as an example of the `beforeCommand`/`afterCommand` hooks ([README.md](https://github.com/sequelize/umzug/blob/d94dfaeb908a67cf54c8fe85bc197d36f3b2675d/README.md) L580).

## 6. Prisma Migrate, Prisma 7 and earlier

Pinned: `prisma/prisma-engines` tag `7.9.1` (`e922089b7d7502aff4249d5da3420f6fa55fc6ad`); the same lock code is on main (`d1b3f377ca835d73fd50954a5e22128b9ebdd6b8`). The `prisma/prisma` repository now redirects to `prisma/orm`, so its issues are under `github.com/prisma/orm/issues/...`.

### The lock that stops two runs at once

- Session-level `pg_advisory_lock(72707369)` with a 10 second client-side timeout: `const ADVISORY_LOCK_TIMEOUT: time::Duration = time::Duration::from_secs(10);` ([schema-engine/connectors/sql-schema-connector/src/flavour/postgres.rs](https://github.com/prisma/prisma-engines/blob/e922089b7d7502aff4249d5da3420f6fa55fc6ad/schema-engine/connectors/sql-schema-connector/src/flavour/postgres.rs) L38), applied as `crosstarget_utils::time::timeout(ADVISORY_LOCK_TIMEOUT, connection.raw_cmd("SELECT pg_advisory_lock(72707369)"))` (L375-L378). It is a timer in the engine around the query, not a Postgres `lock_timeout`. Skipped on CockroachDB (L366).
- `migrate deploy` takes it first: `connector.acquire_lock().await?;` ([schema-engine/commands/src/commands/apply_migrations.rs](https://github.com/prisma/prisma-engines/blob/e922089b7d7502aff4249d5da3420f6fa55fc6ad/schema-engine/commands/src/commands/apply_migrations.rs) L20).
- Error on timeout: user-facing `DatabaseTimeout`, code `P1002`, "The database server was reached but timed out. Please try again." ([libs/user-facing-errors/src/common.rs](https://github.com/prisma/prisma-engines/blob/e922089b7d7502aff4249d5da3420f6fa55fc6ad/libs/user-facing-errors/src/common.rs) L32-L48), with context "Timed out trying to acquire a postgres advisory lock (SELECT pg_advisory_lock(72707369)). Timeout: 10000ms." (postgres.rs L382). Older versions printed "Elapsed: 10000ms" (seen in user reports below).
- No retry: the timeout maps straight to an error (postgres.rs L380-L385).
- Not configurable; can be disabled. Env var `PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK`, any value other than empty or `0` disables it ([schema-engine/connectors/sql-schema-connector/src/lib.rs](https://github.com/prisma/prisma-engines/blob/e922089b7d7502aff4249d5da3420f6fa55fc6ad/schema-engine/connectors/sql-schema-connector/src/lib.rs) L421-L435). Docs: "Advisory locking has a 10 second timeout (not configurable)" and "Since 5.3.0, the advisory locking can be disabled using the PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK environment variable" ([prisma.io docs, Development and production, Advisory locking](https://www.prisma.io/docs/orm/prisma-migrate/workflows/development-and-production#advisory-locking); `pris.ly/d/migrate-advisory-locking` redirects there).
- MySQL uses `GET_LOCK('prisma_migrate', 10)` with the same 10 second constant ([flavour/mysql.rs](https://github.com/prisma/prisma-engines/blob/e922089b7d7502aff4249d5da3420f6fa55fc6ad/schema-engine/connectors/sql-schema-connector/src/flavour/mysql.rs) L28, L173).

### Issues where the 10 second limit failed deploys, and what users asked for

- [prisma/orm#12999](https://github.com/prisma/orm/issues/12999) (open, 2022): "Advisory locks not released on failed migrations". Comments describe deploy failures with several instances:
  - 2023-08-30 [comment](https://github.com/prisma/orm/issues/12999#issuecomment-1699577261): containers run `migrate` at start; ECS killed the first container for failing health checks during an hours-long `UPDATE`, but its session kept running and kept the lock, so every new container failed after 10 s.
  - 2024-08-27 [comment](https://github.com/prisma/orm/issues/12999#issuecomment-2313337419): on DigitalOcean App Platform, new deploys randomly fail to get the lock after 10 s, which the user suspects is several instances at once. The recovery steps include finding and killing a migration's `ALTER TABLE` that was stuck in `wait_event_type = 'Lock'`. That is the unbounded table-lock wait this research is about.
  - 2025-01-30 comment: "multiple services concurrently try to get the lock".
  - Users asked how to release the lock without restarting the database. Nobody in the thread asks to raise or configure the 10 s value.
- [prisma/orm#27636](https://github.com/prisma/orm/issues/27636) (open, 2025-07-11): `migrate deploy` on DigitalOcean (6.11) fails with P1002 "Timeout: 10000ms", with several `SELECT pg_advisory_lock(72707369)` queries visible per build. Asks that migrations apply "without timeout issues".
- [prisma/prisma-engines#5755](https://github.com/prisma/prisma-engines/issues/5755) (open, 2026-02-05): a second instance waiting in `pg_advisory_lock` can deadlock with the first instance's `CREATE INDEX CONCURRENTLY`, which waits for the waiting transaction. It asks to switch to `pg_try_advisory_lock` and fail at once with "another instance must be running". Maintainer jacek-prisma, 2026-02-26: "raising an error immediately instead of waiting should be fine". PR [prisma/prisma-engines#5809](https://github.com/prisma/prisma-engines/pull/5809) (open since 2026-05-06) makes that change; not merged, so 7.9.1 and main still wait 10 s.
- [prisma/orm#14454](https://github.com/prisma/orm/issues/14454) (closed): asked for a lock so several replicas running `migrate deploy` at start do not race; answered by pointing to advisory locking.
- [prisma/orm#25996](https://github.com/prisma/orm/issues/25996) (closed): running two deploys in parallel with the lock disabled breaks `_prisma_migrations`; the answer was that parallel runs are not supported.
- I found no issue that asks to make the 10 s advisory-lock timeout configurable. GitHub issue search is incomplete, so treat this as "not found", not "does not exist".

### Limits on the migration statements themselves

- **`lock_timeout` set by Prisma?** No. In `prisma-engines` the only `lock_timeout` matches are the `ADVISORY_LOCK_TIMEOUT` constant (code search; postgres.rs, mysql.rs, wasm connector). No `SET lock_timeout` or `statement_timeout` before migration SQL.
- **How a user limits it:** by writing `SET lock_timeout = '...'` in `migration.sql`. [prisma/orm#22922](https://github.com/prisma/orm/issues/22922) (open, 2024) gives `SET lock_timeout = '30s'` as a common need for "traffic heavy" applications. Before 7.4.0 that `SET` made a following `CREATE INDEX CONCURRENTLY` fail (see transactions below). A 2025-12-10 comment notes a session-level `SET` in one migration carries over "to all later migrations being applied at the same time".
- **Scope / retry / timeout error:** not applicable; a user's own `SET` is session-scoped and the Postgres error surfaces as a failed migration.
- **Transactions:** Prisma does not wrap a migration in a transaction. The engine's design doc: "Why does Migrate not run migrations in a transaction by default?", and users may add `BEGIN;`/`COMMIT;` themselves ([schema-engine/ARCHITECTURE.md](https://github.com/prisma/prisma-engines/blob/e922089b7d7502aff4249d5da3420f6fa55fc6ad/schema-engine/ARCHITECTURE.md) L373-L383).
  - Since prisma-engines 7.4.0 the script is split and each statement sent separately: "the Postgres simple protocol automatically wraps the script in a transaction, which is sometimes undesirable" ([flavour/postgres/connector/native/mod.rs](https://github.com/prisma/prisma-engines/blob/e922089b7d7502aff4249d5da3420f6fa55fc6ad/schema-engine/connectors/sql-schema-connector/src/flavour/postgres/connector/native/mod.rs) L146-L156). This came from PR [#5767](https://github.com/prisma/prisma-engines/pull/5767) (merged 2026-02-11). Tag 7.3.0 does not contain it and 7.4.0 does (GitHub compare).
  - Before that, a multi-statement `migration.sql` went as one simple-protocol query, which Postgres runs as one implicit transaction. That is why issue #22922 saw `CREATE INDEX CONCURRENTLY` fail after a `SET`.
- No issue found that asks for `lock_timeout` on `migrate deploy` itself. The closest is #22922, about using `SET lock_timeout` by hand.

## Unverified claims

- node-pg-migrate and Knex: that a user can set `lock_timeout` with raw SQL in a migration (`pgm.sql`, `knex.raw`). This follows from the tools running raw SQL; I found no doc that recommends it.
- Whether a Postgres `lock_timeout` the user sets would also limit the wait in `pg_advisory_lock` (node-pg-migrate `wait` mode, Prisma). The Postgres docs were not checked for this.
- Prisma: whether the `pg_advisory_lock` query keeps waiting on the server after the engine's 10 s timer fires. #27636 shows several such queries per build, which suggests it does, but I did not confirm this in the code.
- Prisma: that engine tag `7.4.0` matches the Prisma CLI release 7.4.0. The tag names match; I did not check the CLI's pinned engine version.
- Drizzle: what a second concurrent run does in practice (for example, blocks on DDL locks, then fails on "already exists"). This is not shown in the source; the source only shows that no lock exists.
- Knex: that the default wrapped-transaction case waits on the row lock. I read this from the code and its comment (Migrator.js L490-L492); I did not run it.
- That no Prisma issue asks to make the 10 s timeout configurable. Search found none, but GitHub issue search is incomplete.
