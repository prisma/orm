# @internal/driver-mysql

MySQL runtime and control drivers for Prisma 8, built on mysql2.

## Package Classification

- **Domain**: targets
- **Layer**: drivers
- **Plane**: multi-plane (shared, migration, runtime)

## Purpose

Connects the runtime and the control plane to a MySQL server and hands codecs the text the server sends ([ADR 155](../../../../docs/architecture%20docs/adrs/ADR%20155%20-%20Driver%20Codec%20Boundary%20and%20Lowering%20Responsibilities.md)).

## Responsibilities

- **Prepared statements**: a statement with values runs as a server-side prepared statement, mysql2's `execute()`, so a value never travels inside the SQL. `src/core/positional-params.ts` writes the adapter's numbered `?N` as MySQL's positional `?` and orders the values to match, a value repeated as often as its `?N` appears; a bare `?` takes the values in order. It reads the SQL with the target's lexer, so a `?` inside a quoted string, a backtick identifier or a comment stays text, and an executable `/*!` comment is refused. A statement whose placeholders and values do not match raises `RUNTIME.PARAM_PLACEHOLDER_MISMATCH`; a safe integer is sent as a JavaScript bigint, because mysql2 sends a number as a double, which MySQL refuses where it needs an integer, as in `LIMIT`. mysql2 sends a bigint as its decimal text: MySQL gives that text the type of a column it is compared with, and the adapter casts an integer param everywhere else (see the adapter README). A statement MySQL cannot prepare, such as `LOCK TABLES`, fails with `DRIVER.PREPARE_FAILED`. Each connection keeps at most `statementCacheSize` prepared statements, 100 by default and at most 1,000, and closes the ones it drops: MySQL caps open statements server-wide (16,382 by default), and reaching that cap fails with `DRIVER.PREPARE_FAILED`. A `LIMIT` or `OFFSET` value that is not an integer fails with `RUNTIME.ARGUMENT_INVALID`. SQL the driver or the control plane writes with no values, such as the session setup and `START TRANSACTION`, which MySQL does not prepare, runs through the text protocol, `query()`. `multipleStatements` stays off.
- **Connection URL** (`src/core/connection-options.ts`): reads `ssl`, `connectTimeout` and `flags` as connection options and `connectionLimit`, `poolTimeout` (milliseconds, ten seconds by default) and `statementCacheSize` as pool settings, and refuses any other parameter with `RUNTIME.BINDING_INVALID`. Every connection uses utf8mb4 and a `charset` parameter is refused: the driver reads each statement as utf8mb4 to find its placeholders, and under a narrower charset MySQL can read a character of raw SQL as a quote or a backslash, so the two would disagree about where a placeholder is.
- **Session setup** (`src/core/session-setup.ts`): every connection clears `NO_BACKSLASH_ESCAPES` and `ANSI_QUOTES`, so MySQL reads quoted text as the driver's lexer does when it finds placeholders, and runs in UTC and in utf8mb4. The setup runs once per connection, before its first statement. A raw `SET` stays on the connection for its lifetime, as on Postgres: the connection goes back to the pool with the setting, and later statements on it see it.
- **Rows**: a prepared statement's rows come over the binary protocol, read with a bigint and a decimal as their exact text, a date and time as the text MySQL prints, JSON as UTF-8 text and binary strings as Buffers; an `int` reads as a number, a FLOAT as its widened double, a TIME without trailing fraction zeros and a YEAR as a number. Text-protocol rows go through `src/core/server-text.ts`, a `typeCast` that returns every column as text.
- **Errors**: a query error MySQL reports becomes a `SqlQueryError` carrying its SQLSTATE; a failed connection is `DRIVER.CONNECTION_FAILED` with the URL redacted.
- **Runtime driver** (`./runtime`): a mysql2 pool whose statements all run as prepared statements. Each physical connection runs the session setup once, before its first statement, and goes back to the pool after each statement; a lost or broken connection is destroyed. Rows stream through the connection; a stream whose connection is lost ends with `DRIVER.NOT_CONNECTED`, and a lost connection or a fatal error evicts it. When the caller stops reading a stream early, a connection the pool lent for that statement is evicted, and a connection the caller holds reads and drops the rest so its session survives. A transaction runs on one connection. A statement that waits longer than `poolTimeout` for a connection fails with `DRIVER.CONNECTION_FAILED`. `close()` waits for every connection and stream it has handed out.

## Exports

- `./runtime`: the runtime driver descriptor
- `./control`: the control driver descriptor and `MysqlControlDriver`
