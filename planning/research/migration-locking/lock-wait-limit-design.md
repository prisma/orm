# Proposed design: the Postgres migration runner limits each wait for a table lock

Issue: https://github.com/prisma/orm/issues/31182 (saved in `wip/lock-timeout/issue.json`). Status: proposal under review. Nothing is implemented.

## Problem

A migration statement such as `ALTER TABLE` needs an `ACCESS EXCLUSIVE` lock. If another session holds any lock on the table (an open transaction that only read it is enough), the statement waits, and Postgres queues every new statement on that table behind it. The runner (`packages/3-targets/postgres/1-target/src/core/migrations/runner.ts`) runs every space's plan in one transaction and sets no `lock_timeout`, so the wait and the outage of the table have no limit.

## Design

1. **Where the limit is set.** After the runner first takes the marker advisory lock in its transaction, it runs `SELECT set_config('lock_timeout', $1, true)`. The setting lasts for the transaction only (same mechanism as the runner's `lc_monetary`). It covers every later statement of the run: operations, prechecks, postchecks, control-table setup, schema verification, marker and ledger writes, for every space.
2. **Default.** 5000 milliseconds.
3. **Configuration.** One setting on the Postgres target's config: `defineConfig({ migrations: { lockTimeoutMs: 5000 } })` in `packages/3-targets/postgres/9-facade/src/config/define-config.ts`. `0` turns the limit off. `defineConfig` builds the Postgres control target descriptor with the value, and the descriptor's `createRunner` passes it to the runner. No command flag, no environment variable, no option on the control API's `MigrateOptions`, and no change under `packages/1-framework`.
4. **A `lock_timeout` the session already has** (connection string, `PGOPTIONS`, role setting) is overridden inside the runner's transaction by the configured value.
5. **No automatic retry.** A timeout rolls the whole transaction back (`databaseUnchanged: true`). The caller runs the command again.
6. **Failure.** SQLSTATE `55P03` from any statement after the limit is set becomes a new structured error `MIGRATION.LOCK_TIMEOUT`: the operation and its table when the statement belongs to one, the limit, `databaseUnchanged: true`, and the advice to run the command again, find the blocking session, or raise `migrations.lockTimeoutMs`. `failedTypeChangeOf` stops treating `55P03` as a failed type conversion. The error is added to `docs/reference/error-reference.md`.
7. **Marker advisory lock.** Unchanged in this work: it is taken before the limit is set and still waits without limit, because replicas that migrate at start-up are meant to wait for each other (#29990, #30658; Prisma 7's 10-second limit on its advisory lock made such deploys fail, #27636). Bounding it (MySQL uses 60 seconds and `MIGRATION.MARKER_LOCK_TIMEOUT`) is a separate issue. `db sign` takes the same lock through `PostgresControlAdapter.lockMarker` and is also unchanged.
8. **Other commands.** `db update` and `db init` apply plans through the same runner, so they get the same limit.
9. **MySQL and MariaDB.** Not in this work. A separate issue: their DDL is not transactional, and the setting is the session variable `lock_wait_timeout` (default one year).
10. **Upgrade note.** A migration that succeeded only by waiting more than 5 seconds for a lock now fails with `MIGRATION.LOCK_TIMEOUT` and an unchanged database. Set `migrations.lockTimeoutMs` to raise the limit, or `0` for the old behaviour. A `lock_timeout` set on the connection no longer applies inside a migration.

## Prior art (details and sources in `prior-art-a.md` to `prior-art-d.md` in this folder)

- No limit unless the user writes `SET lock_timeout` by hand: Rails, Django, Alembic, sqitch, Flyway, Liquibase, Atlas, golang-migrate, goose, node-pg-migrate, Knex, Drizzle, TypeORM, Sequelize, Prisma 7.
- A moderate limit, retry optional: safe-pg-migrations (about 5 s; 5 retries 1 minute apart, per statement, outside a transaction), strong_migrations (10 s from its generated initializer; retries off by default).
- A very short limit with automatic retry: pgroll (500 ms, unlimited retries with backoff), Reshape (1 s, 10 attempts), GitLab (0.1 to 2 s, whole migration retried many times). Postgres operators recommend 1 to 3 s plus retry.

## Alternatives considered

- Automatic retry with a 1 to 2 second limit. Rejected for now: it reruns the whole transaction, data changes included, without the user asking.
- Keep the session's own `lock_timeout` when it has one. Rejected: two ways to set one thing; connection-level settings also cover the marker lock and poolers can refuse them.
- A command flag or a control API option. Rejected: both live in the framework packages, which know nothing about Postgres locks.
- No default, only a warning.
