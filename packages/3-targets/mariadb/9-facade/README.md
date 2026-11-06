# @internal/mariadb

MariaDB configuration, control client and migration classes for Prisma 8.

## Package Classification

- **Domain**: extensions
- **Layer**: adapters
- **Plane**: multi-plane (shared, migration)

## Purpose

Wires the MariaDB target, adapter and driver together for a project's `prisma.config.ts`, the CLI and each `migration.ts`.

## Responsibilities

- **`defineConfig`** (`./config`): a MariaDB project's configuration, built with MySQL's `createMysqlDefineConfig`. The contract must be a `.prisma` schema; any other contract path, a TypeScript contract included, is refused with `CONFIG.VALIDATION_FAILED`, because the TypeScript contract builder builds MySQL contracts.
- **`createMariadbControlClient`** (`./control`): a control client for `migration plan`, `db migrate`, `db verify`, `db sign` and introspection.
- **`./migration`**: what a MariaDB `migration.ts` imports: `Migration`, which is `MariadbMigration`, `MigrationCLI` and the rest of MySQL's migration module.

There is no `mariadb()` runtime client yet.

## Testing

The live tests need `MARIADB_URL` and are skipped without it, except in CI, where `test/live-server.test.ts` fails without it: `MARIADB_URL='mysql://root@127.0.0.1:3368/' pnpm test` against `docker run -p 3368:3306 -e MARIADB_ALLOW_EMPTY_ROOT_PASSWORD=1 mariadb:10.11`. `test/fixtures/` holds PSL contracts the tests emit in memory.
