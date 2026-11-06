# @internal/adapter-mariadb

MariaDB control adapter for Prisma 8.

## Package Classification

- **Domain**: targets
- **Layer**: adapters
- **Plane**: multi-plane (shared, migration)

## Purpose

Builds MySQL's control adapter ([`@internal/adapter-mysql`](../../mysql/2-adapter/README.md)) for the `mariadb` target, with a catalog reader that converts what MariaDB 10.11 reports into what MySQL 8.4 reports, so MySQL's introspection, default reader and schema verifier read it unchanged.

## Responsibilities

- **Catalog reader** (`src/core/migrations/catalog.ts`): reads indexes with `NULL AS expression`, since MariaDB has no functional indexes and no `STATISTICS.EXPRESSION` column, and converts each column row:
  - the display width of `tinyint`, `smallint`, `mediumint`, `int` and `bigint` is removed, keeping `unsigned`: `int(11)` reads as `int` and `int(10) unsigned` as `int unsigned`. A signed `tinyint(1)` and a `zerofill` column keep their width, as MySQL 8.4 prints them; MySQL 8.4 prints `tinyint(1) unsigned` as `tinyint unsigned`, and so does the reader;
  - a default MariaDB reports as the text `NULL` is no default;
  - a quoted literal default is unquoted, with `''` and backslash escapes read as MariaDB reads them, so `'it''s'` is `it's`;
  - an unquoted number, such as `0` or `1.50`, stays a literal;
  - any other default, such as `current_timestamp(3)` or `curdate()`, is a function, marked `DEFAULT_GENERATED` as MySQL marks it.
- **Capabilities** (`src/core/capabilities.ts`): MySQL's, with `returning` off. MariaDB 10.11 has `INSERT … RETURNING` and `DELETE … RETURNING` but no `UPDATE … RETURNING`, and the capability covers every statement kind.
- **Codec types**: `contract.d.ts` imports `CodecTypes` from `@internal/adapter-mariadb/codec-types`, which is MySQL's.

The marker upsert binds its values twice instead of naming a row alias, which MariaDB does not accept, so it is MySQL's statement unchanged. There is no runtime adapter yet.

## Testing

The live tests need `MARIADB_URL` and are skipped without it: `MARIADB_URL='mysql://root@127.0.0.1:3368/' pnpm test` against `docker run -p 3368:3306 -e MARIADB_ALLOW_EMPTY_ROOT_PASSWORD=1 mariadb:10.11`.

## Exports

- `./control`: the control adapter descriptor, `readMariadbCatalog`, `asMysqlColumnRow` and `MARIADB_CATALOG_QUERIES`
- `./codec-types`: `CodecTypes`
