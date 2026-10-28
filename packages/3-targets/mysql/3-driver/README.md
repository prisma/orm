# @internal/driver-mysql

MySQL runtime and control drivers for Prisma 8, built on the `mariadb` package (3.5.4 or later).

## Package Classification

- **Domain**: targets
- **Layer**: drivers
- **Plane**: multi-plane (shared, migration, runtime)

## Purpose

Connects the runtime and the control plane to a MySQL server and hands codecs the text the server sends ([ADR 155](../../../../docs/architecture%20docs/adrs/ADR%20155%20-%20Driver%20Codec%20Boundary%20and%20Lowering%20Responsibilities.md)).

## Responsibilities

- **Prepared statements**: every statement the runtime driver runs, raw SQL included and even with no values, is a server-side prepared statement (`prepare` then `execute` or `executeStream`), so a value never travels inside the SQL. A raw `START TRANSACTION` or `LOCK TABLES`, which MySQL does not prepare, fails with `DRIVER.PREPARE_FAILED`. `src/core/positional-params.ts` writes the adapter's numbered `?N` as MySQL's positional `?` and orders the values to match, a value repeated as often as its `?N` appears; a bare `?` takes the values in order. It reads the SQL with the target's lexer, so a `?` inside a quoted string, a backtick identifier or a comment stays text, and an executable `/*!` comment is refused. A statement whose placeholders and values do not match, by the lexer or by the count MySQL reports when it prepares the statement, raises `RUNTIME.PARAM_PLACEHOLDER_MISMATCH`. A `LIMIT` or `OFFSET` value that is not an integer fails with `RUNTIME.ARGUMENT_INVALID`. `multipleStatements` and every option that rewrites SQL on the client stay off.
- **Values**: every integer is sent as a 64-bit BIGINT, because the package sends a number as INT only below 2^31 - 1 and otherwise as DOUBLE, which MySQL refuses in `LIMIT`; an integer outside the signed 64-bit range is refused, because the package crashes the process on one. A `Uint8Array` is sent as a Buffer over the same bytes. A `Date` is refused: the package encodes it in the process's local time zone, and the MySQL codecs send dates as text. The package's `logParam` is off, so values never appear in error messages.
- **Prepared-statement cache**: off by default (`prepareCacheLength: 0`), so each statement is prepared, run and closed. `statementCacheSize` in the URL turns it on with that many statements per connection. Two risks come with it: MySQL caps open statements across all connections (`max_prepared_stmt_count`, 16,382 by default), and reaching the cap fails with `DRIVER.PREPARE_FAILED`; and since MySQL 8.0.22 a cached statement keeps the parameter types of its first run, so a value sent later as another type is converted.
- **Connection URL** (`src/core/connection-options.ts`): reads `ssl` (`true`, or a JSON object of `ca`, `cert`, `key`, `passphrase`, `servername` and `rejectUnauthorized`), `connectTimeout` (ten seconds by default), `allowPublicKeyRetrieval` (off by default; MySQL 8.4's `caching_sha2_password` needs it, or TLS, over plain TCP), `connectionLimit`, `poolTimeout` (milliseconds, ten seconds by default) and `statementCacheSize`, validated with arktype, and refuses any other parameter with `RUNTIME.BINDING_INVALID`. Every connection uses utf8mb4 and a `charset` parameter is refused: the driver reads each statement as utf8mb4 to find its placeholders, and MySQL must read it the same way.
- **Session setup** (`src/core/session-setup.ts`): the package runs it once on each physical connection (`initSql`). It clears `NO_BACKSLASH_ESCAPES` and `ANSI_QUOTES`, so MySQL reads quoted text as the driver's lexer does, and sets UTC and utf8mb4. There is no reset on release: a raw `SET` stays on the connection for its lifetime, as on Postgres. The pool rolls back a transaction left open on a connection it gets back.
- **Rows**: BIGINT reads as a `bigint`, DECIMAL as its digits, DATE and DATETIME as the text MySQL prints, JSON as its text, BIT(1) and binary strings as Buffers, TIME as text with six fraction digits when it has any, YEAR as a number and FLOAT as its widened double. The control driver reads every column as the text MySQL sends, over either protocol, through `src/core/server-text.ts`.
- **Errors**: a lost connection (the package marks it fatal, error 45009) is `DRIVER.NOT_CONNECTED` and its connection is destroyed; any other error MySQL reports becomes a `SqlQueryError` carrying its SQLSTATE; a pool that gives no connection within `poolTimeout` is `DRIVER.CONNECTION_FAILED`, with the reason it could not connect; a failed control connection is `DRIVER.CONNECTION_FAILED` with the URL redacted.
- **Runtime driver** (`./runtime`): a `mariadb` pool. A connection goes back to the pool after each statement as it is; it is destroyed only when it is lost or broken, or when the caller stops reading a stream the pool lent it for, so a large result is not downloaded only to be thrown away. A connection the caller holds reads and drops the rest of a stream it stops early, so its session survives. Transactions use the package's `beginTransaction()`, `commit()` and `rollback()`. `close()` waits for every connection and stream it has handed out, then ends the pool.
- **Control driver** (`./control`): one connection. A statement with values runs prepared; SQL with no values, which the control plane writes itself, runs through the text protocol, because MySQL does not prepare some of it, such as `START TRANSACTION`.

## Exports

- `./runtime`: the runtime driver descriptor
- `./control`: the control driver descriptor and `MysqlControlDriver`
