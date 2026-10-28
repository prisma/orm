# @internal/adapter-mysql

MySQL adapter for Prisma 8: query lowering for the runtime, and the control adapter.

## Package Classification

- **Domain**: targets
- **Layer**: adapters
- **Plane**: multi-plane (shared, migration, runtime)

## Purpose

Lowers the queries the ORM and the SQL builder build into MySQL SQL, and reads and writes a MySQL database for the control plane: introspection into the SQL family's schema IR, the marker and ledger, the marker lock, the control tables' DDL and transactions.

## Responsibilities

- **Capabilities**: `foreignKeys`, `orderBy`, `limit` and `enums`. Not `returning`, `lateral` or any conflict target.
- **Introspection** (`src/core/migrations/introspection.ts`): reads `information_schema` for `TABLE_SCHEMA = DATABASE()`. A column's type is `COLUMN_TYPE` as reported; `EXTRA` marks `auto_increment` and expression defaults (`DEFAULT_GENERATED`), and an unquoted `COLUMN_DEFAULT` is a literal the column's codec reads. Unique constraints are split from plain indexes by `TABLE_CONSTRAINTS`, and the index InnoDB creates for a foreign key, which carries the key's name and columns, is left out. The mapping takes catalog rows, so it is tested without a server.
- **Marker and ledger reads and writes**, **`withTransaction`** (`START TRANSACTION`), and the `CREATE TABLE IF NOT EXISTS` statements for the control tables. `initMarker` writes with `INSERT … ON DUPLICATE KEY UPDATE`. MySQL has no `RETURNING`, so `updateMarker` reads and locks the row with `FOR UPDATE` inside the caller's transaction and writes it only when it still holds the expected hash.
- **`holdMarkerLock`** takes the marker lock, a `GET_LOCK` MySQL holds for the session, around the work it guards and releases it with `RELEASE_LOCK` when that work ends; `db sign` creates the marker table and writes the markers inside it. `lockMarker` takes no lock, because the lock is already held around the transaction. The migration runner takes the same lock through the same helper.
- **Query lowering** (`src/core/sql-renderer.ts`), used by the runtime adapter:
  - Backtick quoting. Each parameter is written as `?N`, N being its position in `collectOrderedParamRefs`, the order the runtime encodes parameters in; a parameter written twice is bound once. `src/core/placeholders.ts` then checks that every placeholder names a parameter and every parameter has one, and raises `RUNTIME.PARAM_PLACEHOLDER_MISMATCH` otherwise, as for a `?` written into raw SQL text. The driver sends the values apart from the SQL, as a prepared statement's parameters. mysql2 sends an integer value as text, so an `int` or `bigint` param, decided from its codec's data type, is written `CAST(?N AS SIGNED)`, which keeps `?1 < ?2`, `GREATEST`, `JSON_ARRAY(?1)` and arithmetic past 2^53 integer; `LIMIT` and `OFFSET`, which take only a bare placeholder, read it as an integer themselves. A literal the AST carries is written inline only when it is a number, a bigint, a boolean or NULL, which only code writes, such as the ORM's `1`; a text, date or JSON literal is refused with `RUNTIME.AST_UNSUPPORTED`, because only a caller could supply it and a caller's value belongs in a param. `JSON_OBJECT` keys, which are contract field and relation names, are written through the target's `escapeLiteral`, which doubles quotes and backslashes.
  - `<=>` for IS NOT DISTINCT FROM, a leading `x IS NULL` sort key for NULLS FIRST and NULLS LAST, the largest row count MySQL takes for an `OFFSET` with no `LIMIT`.
  - A to-one include and an unordered array use `JSON_ARRAYAGG`. A to-many include with an order uses `GROUP_CONCAT(… ORDER BY …)` cast to JSON, because `JSON_ARRAYAGG` takes no `ORDER BY`; the statement raises `group_concat_max_len` itself with a `SET_VAR` hint, so it does not depend on the driver's session. An include with no rows is `JSON_ARRAY()`. Text longer than `max_allowed_packet` makes MySQL's `CONCAT` return NULL with only a warning, so a NULL array with rows fails the statement instead of reading as empty. MySQL reports that failure as `Invalid JSON text in argument 1 to function cast_as_json`, which names neither the include nor `max_allowed_packet`: the driver cannot tell it from any other invalid JSON cast, so it passes the error on unchanged. This size limit applies only once an include has an order.
  - Refused with `RUNTIME.AST_UNSUPPORTED`: FULL and LATERAL joins, function sources, row locks, DISTINCT ON, non-finite numbers, and writes.
- **Runtime adapter** (`./runtime`): lowers with the renderer, infers a codec for bare values in raw SQL, and reads the marker from the control tables through `src/core/marker-read.ts`, which the control adapter shares.
- **Not yet built**: the control adapter's own query lowering, which still refuses with `RUNTIME.AST_UNSUPPORTED`; the control plane runs SQL text.

## Driver contract

The SQL this adapter lowers is not runnable as written: each parameter is a numbered `?N`, which MySQL does not read. A driver used with this adapter must rewrite each `?N` to MySQL's positional `?`, order the values to match, and send them as a server-side prepared statement's parameters, never inside the SQL. `@internal/driver-mysql` does this. The adapter writes an `int` or `bigint` parameter as `CAST(?N AS SIGNED)` only because mysql2 sends a JavaScript `BigInt` as text, and a comparison with no column to give that text a type, such as `?1 < ?2`, would compare it as text. A driver that sends integers as integers would not need the cast.

## Exports

- `./runtime`: the runtime adapter descriptor
- `./control`: the control adapter descriptor, `MysqlControlAdapter` and `buildMysqlSchemaIR`
- `./adapter`: capabilities and contract contributions
- `./codec-types`: the `CodecTypes` an emitted `contract.d.ts` imports
