# @internal/mysql

MySQL client, configuration, contract builder and control client for Prisma 8.

## Package Classification

- **Domain**: extensions
- **Layer**: adapters
- **Plane**: multi-plane (shared, migration, runtime)

## Purpose

Wires the MySQL target, adapter and driver together for a project's `prisma.config.ts` and for TypeScript contracts.

## Responsibilities

- **`defineConfig`** (`./config`): a MySQL project's configuration. A `.prisma` contract types a text `enum` block as a native MySQL enum (`mysql/enum@1`) and an integer one as `int`.
- **`defineContract`** (`./contract-builder`): the TypeScript contract builder bound to the MySQL packs.
- **`createMysqlControlClient`** (`./control`): a control client for `migration plan`, `db migrate`, `db verify`, `db sign` and introspection.
- **`./migration`**: what a MySQL `migration.ts` imports: `Migration`, `MigrationCLI` and the column and constraint helpers.
- **`mysql({ contract, url })`** (`./runtime`): a lazy MySQL client with `orm`, `sql`, `raw`, `query`, `execute`, `transaction` and `close`, as `sqlite(...)` and `postgres(...)` have. It connects on its first query. As in `postgres(...)`, the URL must use `mysql://` (`RUNTIME.BINDING_INVALID` otherwise), a query reads its whole result before the first row unless `stream: true` is set, and `poolOptions` takes `connectionTimeoutMillis` (20 seconds by default) and `idleTimeoutMillis` (30 seconds), plus `max` (10), the pool size: a Postgres user sizes a pool by passing a `pg.Pool`, but the MySQL driver builds its own, because it depends on capability flags set when each connection signs in. `stream` must be a boolean (`RUNTIME.ARGUMENT_INVALID` otherwise, checked when `mysql()` is called, as `postgres()` checks `cursor`); it is not a cursor with a batch size, because MySQL has no server-side cursor for a query. With `stream: true`, a statement awaited inside the loop over a stream on the same transaction never finishes, as on Postgres with `cursor`.
- **`contractFromJson`** (`./static`): validates an emitted `contract.json` once; `mysqlStatic` gives the query surfaces without a driver.
- Published as `@prisma/orm-mysql`.

## Testing

`test/fixtures/` holds the project's example contract in PSL with its emitted `generated/` files, which `pnpm fixtures:check` keeps stable. The live tests need `MYSQL_URL` and are skipped without it. `docker compose up mysql` starts MySQL 8.4 for them: `MYSQL_URL='mysql://root:root@127.0.0.1:3307/mysql?allowPublicKeyRetrieval=true' pnpm test`. The server has no TLS, so the URL lets the driver fetch its public key to sign in with `caching_sha2_password`.
