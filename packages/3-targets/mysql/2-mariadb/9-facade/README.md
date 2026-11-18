# @internal/mariadb

MariaDB configuration, control client, migration classes and query client for Prisma 8.

## Package Classification

- **Domain**: extensions
- **Layer**: adapters
- **Plane**: multi-plane (shared, migration, runtime)

## Purpose

Wires the MariaDB target, adapter and driver together for a project's `prisma.config.ts`, the CLI, each `migration.ts` and the application's client.

## Responsibilities

- **`defineConfig`** (`./config`): a MariaDB project's configuration, built with MySQL's `createMysqlDefineConfig`. The contract is a Prisma schema: a `.prisma` file, a folder of them, or a glob. `createMysqlDefineConfig` refuses a TypeScript contract (`.ts`, `.mts`, `.cts`, `.tsx`) with `CONFIG.VALIDATION_FAILED`.
- **`createMariadbControlClient`** (`./control`): a control client for `migration plan`, `db migrate`, `db verify`, `db sign` and introspection.
- **`./migration`**: what a MariaDB `migration.ts` imports: `Migration`, which is `MariadbMigration`, `MigrationCLI` and the rest of MySQL's migration module.
- **`mariadb({ contract, url })`** (`./runtime`): MySQL's `createMysqlClient` applied to MariaDB's runtime target, adapter and driver. It takes every option `mysql()` takes (`MariadbOptions`) and returns a `MariadbClient`. Every type the entry exports has a MariaDB name: `MariadbPoolOptions`, `MariadbTransactionOptions`, `MariadbBindingInput` and the rest alias MySQL's. The URL must use `mariadb://` or `mysql://`. A contract emitted for another target fails with `RUNTIME.CONTRACT_TARGET_MISMATCH`. MariaDB loads includes with one query per relation, since its adapter reports neither `sql.outerReferencesInDerivedTables` nor `sql.jsonAggWithoutTruncation`.
- **`contractFromJson`** and the static context (`./static`): both from one call to MySQL's `createMysqlStatic`, so they validate with one validator.

## Requirements

These hold on MariaDB 10.11 as on MySQL 8.4; each was checked on a live MariaDB 10.11 server.

- **Transactions the ORM owns run at READ COMMITTED.** The driver starts each with `SET TRANSACTION ISOLATION LEVEL READ COMMITTED`. A `db.transaction()` without an isolation level, and a statement outside a transaction, run at the server's default, REPEATABLE READ on MariaDB 10.11. Prisma sets no session isolation level.
- **Binary logging, when it is on, must be row-based or mixed (`binlog_format = ROW` or `MIXED`, MariaDB 10.11's default being `MIXED`).** With `binlog_format = STATEMENT`, InnoDB refuses a write at READ COMMITTED with error 1665, "Cannot execute statement: impossible to write to binary log", so every ORM write fails.
- **`session_track_system_variables` must keep `character_set_client`,** as MariaDB 10.11's default does. The driver confirms from it that the connection reads statements as utf8mb4 before it sends values, and refuses them otherwise (`RUNTIME.CHARACTER_SET_UNSUPPORTED`).
- **The session's `sql_mode` must not contain `NO_BACKSLASH_ESCAPES` or `ANSI_QUOTES`.** The driver removes both on every connection; raw SQL, stored procedures and triggers must not set them again. The MySQL driver's [environment requirements](../../1-mysql/3-driver/README.md#environment-requirements) give the detail, and hold on MariaDB too.

## Testing

The live tests need `MARIADB_URL` and are skipped without it, except in CI, where `test/live-server.test.ts` fails without it: `MARIADB_URL='mysql://root@127.0.0.1:3368/' pnpm test` against `docker run -p 3368:3306 -e MARIADB_ALLOW_EMPTY_ROOT_PASSWORD=1 mariadb:10.11`. `test/fixtures/` holds PSL contracts the tests emit in memory, and `test/fixtures/generated/` the example contract emitted by `pnpm emit`.

MySQL's ORM live suites run against MariaDB from [`@internal/mysql-live-tests`](../../3-live-tests/README.md).
