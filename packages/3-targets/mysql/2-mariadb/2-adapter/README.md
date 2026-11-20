# @internal/adapter-mariadb

MariaDB control adapter for Prisma 8.

## Package Classification

- **Domain**: targets
- **Layer**: adapters
- **Plane**: multi-plane (shared, migration, runtime)

## Purpose

Builds MySQL's control adapter ([`@internal/adapter-mysql`](../../1-mysql/2-adapter/README.md)) for the `mariadb` target, with a catalog reader that converts what MariaDB 10.11 reports into what MySQL 8.4 reports, so MySQL's introspection, default reader and schema verifier read it unchanged.

## Responsibilities

- **Catalog reader** (`src/core/migrations/catalog.ts`): reads indexes with `NULL AS expression`, since MariaDB has no functional indexes and no `STATISTICS.EXPRESSION` column, and converts each column row:
  - the display width of `tinyint`, `smallint`, `mediumint`, `int` and `bigint` is removed, keeping `unsigned`: `int(11)` reads as `int` and `int(10) unsigned` as `int unsigned`. A signed `tinyint(1)` and a `zerofill` column keep their width, as MySQL 8.4 prints them; MySQL 8.4 prints `tinyint(1) unsigned` as `tinyint unsigned`, and so does the reader;
  - a default MariaDB reports as the text `NULL` is no default;
  - a quoted literal default is unquoted, with `''` and backslash escapes read as MariaDB reads them, so `'it''s'` is `it's`;
  - on a blob column, a quoted literal default is the generated hexadecimal literal of its UTF-8 bytes, `'ab'` as `0x6162`, which is how MySQL reports a blob's default, an expression;
  - on a `binary` or `varbinary` column, a default is left quoted, as MariaDB reports it, because MariaDB quotes even one written in hexadecimal and shows each byte that is not UTF-8 as `?`; MySQL's reader keeps it as an expression;
  - an unquoted number, such as `0` or `1.50`, stays a literal;
  - a bytes default, `X'00ff'`, is MySQL's generated `0x00ff`;
  - any other default, such as `current_timestamp(3)` or `curdate()`, is a function, marked `DEFAULT_GENERATED` as MySQL marks it, with each byte of its UTF-8 shown as one Latin-1 character, as MySQL reports an expression default;
  - a `longtext` column with a column-level check `json_valid(col)` named after the column, which is what MariaDB makes of a `json` column, reads as `json`, the type MySQL reports for it. The reader finds those checks in `information_schema.CHECK_CONSTRAINTS`.
- **Capabilities** (`src/core/capabilities.ts`): MySQL's, with `returning` off. MariaDB 10.11 has `INSERT … RETURNING` and `DELETE … RETURNING` but no `UPDATE … RETURNING`, and the capability covers every statement kind.
- **SQL renderer** (`src/core/sql-renderer.ts`): `MariadbSqlRenderer` subclasses MySQL's `MysqlSqlRenderer` and overrides its three protected methods. MariaDB takes no row alias on an insert, so `proposedRow()` writes none and reads the proposed row's column as `VALUES(column)` where MySQL writes `` `new`.`column` ``. MariaDB has `INSERT … RETURNING` and `DELETE … RETURNING`, so `returningRefusal()` says the adapter does not use them, not that MariaDB lacks them. MySQL builds an ordered array with a `SET_VAR` hint and `CAST(… AS JSON)`, and MariaDB 10.11 has neither, so `orderedJsonArrayRefusal()` refuses an ordered to-many include with a message saying the ORM loads includes on MariaDB with one query per relation.
- **Runtime adapter** (`src/core/runtime/runtime-adapter.ts`, `./runtime`): MySQL's `createMysqlRuntimeAdapterDescriptor` applied to MariaDB's runtime metadata and `MariadbSqlRenderer`. The target id comes from the target's metadata, and the profile id `mariadb/default@1` is derived from it.
- **Contract contributions** (`src/core/contract-contributions.ts`, `./adapter`): MySQL's aggregate overloads with MariaDB's capabilities, which MariaDB's `defineContract` adds to a contract written in TypeScript, as `prisma contract emit` adds them through the adapter's descriptor.
- **Codec types**: `contract.d.ts` imports `CodecTypes` from `@internal/adapter-mariadb/codec-types`, which is MySQL's.

The marker upsert binds its values twice instead of naming a row alias, which MariaDB does not accept, so it is MySQL's statement unchanged.

## Testing

The live tests need `MARIADB_URL` and are skipped without it, except in CI, where `test/live-server.test.ts` fails without it: `MARIADB_URL='mysql://root@127.0.0.1:3368/' pnpm test` against `docker run -p 3368:3306 -e MARIADB_ALLOW_EMPTY_ROOT_PASSWORD=1 mariadb:10.11`.

## Exports

- `./adapter`: the capabilities, the contract contributions and the adapter descriptor metadata
- `./runtime`: the runtime adapter descriptor
- `./control`: the control adapter descriptor
- `./codec-types`: `CodecTypes`
