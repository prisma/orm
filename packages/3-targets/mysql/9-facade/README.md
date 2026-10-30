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

## Environment requirements

`mysql(...)` hands each value to the `mariadb` package, which writes it into the statement as a quoted, escaped literal. A value stays inside its literal only while these hold. Prisma's own SQL meets them; raw SQL, stored procedures and triggers must too. The [driver's README](../3-driver/README.md#environment-requirements) gives the detail.

1. **The session's `sql_mode` must not contain `NO_BACKSLASH_ESCAPES` or `ANSI_QUOTES`.** The driver removes both on every connection it opens; raw SQL, stored procedures and triggers must not add either back, and a mode set on a pooled connection stays on it until it closes. With either mode on, MySQL ends a string or identifier where the package does not, so a value can land outside its literal and run as SQL. The driver refuses a statement with values while MySQL reports `NO_BACKSLASH_ESCAPES` (`RUNTIME.SQL_MODE_UNSUPPORTED`). It cannot see `ANSI_QUOTES`, which MySQL does not report, and after a stored procedure that sets `sql_mode`, MySQL can report a backslash mode the session no longer has, so the driver either sends a value the package escaped for the wrong mode or refuses one while the mode is off.
2. **The session's `character_set_client` and `character_set_results` must stay utf8mb4.** The driver sets them on every connection and refuses a `charset` in the URL; raw SQL, stored procedures and triggers must not change them, with `SET NAMES`, `SET CHARACTER SET` or a `SET` of either variable. After a change to `character_set_client` to a set where the second byte of some characters is a backslash, such as `sjis`, `cp932`, `big5` or `gbk`, the package misreads where a string in raw SQL ends, and a value can run as SQL; in any other set, text it cannot hold is replaced, such as `é` with `?`. After a change to `character_set_results`, every text value read back is wrong, with no error. A `SET NAMES` inside a stored procedure leaves `character_set_results` changed after the procedure returns. The driver refuses a statement with values while it cannot confirm `character_set_client` is utf8mb4 (`RUNTIME.CHARACTER_SET_UNSUPPORTED`). It cannot see a change to `character_set_results`. It sees `character_set_client` only while `session_track_system_variables` includes it, as MySQL's default does; on a server whose default character set is not utf8mb4, leaving it out makes the driver refuse every statement with values.
3. **Raw SQL must not contain a shape the package's placeholder search misreads.** In the first three, the package can put a value inside what MySQL reads as a string literal, and the value runs as SQL:
   - a value directly followed by `'`, `"`, `` ` ``, `#`, `/*`, or a `--` that opens a comment, as in `${a}''`; put a space after the value;
   - a block comment that opens with `/*/`;
   - `--` followed by DEL (0x7f);
   - two values with nothing between them, as in `${a}${b}`, which MySQL then refuses as a syntax error.

## Testing

`test/fixtures/` holds the project's example contract in PSL with its emitted `generated/` files, which `pnpm fixtures:check` keeps stable. The live tests need `MYSQL_URL` and are skipped without it. `docker compose up mysql` starts MySQL 8.4 for them: `MYSQL_URL='mysql://root:root@127.0.0.1:3307/mysql?allowPublicKeyRetrieval=true' pnpm test`. The server has no TLS, so the URL lets the driver fetch its public key to sign in with `caching_sha2_password`.
