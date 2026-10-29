# Design notes — MySQL proof of concept

The reasoning behind each decision in [`spec.md`](./spec.md), the facts it rests on, and the alternatives rejected. Settled in discussion with Will on 2026-10-22.

## 1. One folder per database

**Today.** SQL targets are split by role: `3-targets/3-targets/<db>`, `3-targets/6-adapters/<db>`, `3-targets/7-drivers/<db>`. Mongo keeps its three packages together in `3-mongo-target/`. The facades sit apart from both in `3-extensions/<db>`.

**Decision.** Every database gets one folder, `packages/3-targets/<db>/`, holding `1-target`, `2-adapter`, `3-driver`, `4-codec-testkit` and `9-facade`. Mongo moves too. `2-sql` becomes `2-sql-family`, to match `2-mongo-family`. Extension packs stay in `3-extensions/`.

**Why.**

- The role folders enforce nothing. Domain, layer and plane come from per-file globs in `architecture.config.json`, and that file defines no layer order for the `targets` or `extensions` domains, so the numbers 3, 6 and 7 constrain no import.
- One database's code was spread across three subtrees plus the facade in a fourth. A developer working on a target now opens one folder.
- Package names do not change, so imports, published names and emitted code are untouched. Only `architecture.config.json`, `shells.ts`, `coverage.config.json`, `tsconfig.base.json`, three lint scripts and the docs name paths.
- Numbers inside a database folder keep the repo's convention that a number shows dependency order: the adapter imports the target, the facade imports all three, the driver imports none of them.
- The facade is one database's wiring, so it belongs with the database.
- Extension packs stay apart because they use the same extension points as a third-party pack; keeping first-party packs outside the target shows that.

**Rejected.**

- *Copy Mongo exactly* (`packages/3-mysql-target/{1-mysql-target,...}`): a new top-level folder per database, and the database name repeated in every folder name.
- *Keep the role layout for MySQL*: repeats the spread the move fixes.
- *Move the Postgres-only extension packs under `3-targets/postgres/`*: hides that they are ordinary packs.

**What it reverses.** `.agents/rules/directory-layout.mdc`, ADR 140, `docs/architecture docs/Package-Layering.md` and the Architecture Overview name `packages/3-targets/**` by role as the SQL target home, with MySQL as the example. They are rewritten with the move, and an ADR records the new layout. Mongo's own split (commit 8d14500992) was never recorded as a decision.

## 2. One path through the system

**Decision.** A small PSL contract, migrations, `db verify`, `db sign`, and ORM create, read with include, update, delete and upsert, on MySQL 8.4.

**Why.** The two goals pull apart: finding coupling needs MySQL to touch every subsystem; being production groundwork needs what is built to be correct. A narrow path through every subsystem serves both. The path meets all four known problems: `RETURNING`, transactional DDL, upsert conflicts and shared code that names targets.

**Rejected.** *A broad, shallow MySQL* (many types, stubbed behaviour): finds less coupling per unit of work and leaves code that must be rewritten.

## 3. MariaDB is a separate target that extends MySQL

**Decision.** A `mariadb` target that subclasses the MySQL target, adapter and facade and overrides what differs. Built after MySQL. Will asked for the research to be done and the decision made; these are its findings.

**Why.** Several differences are not capabilities. They change data types, introspection or the shape of SQL, which the target owns:

- **Relation loading.** The ORM loads an include as a scalar subquery over a derived table that refers to the outer row. MariaDB cannot resolve an outer reference inside a derived table and fails with "Unknown column" (MDEV-39357, a duplicate of the open `LATERAL` request MDEV-19078). Prisma 7 disabled relation joins on MariaDB for the same reason. MariaDB needs the correlation in the subquery's own `WHERE`, with `JSON_ARRAYAGG(... ORDER BY ... LIMIT n)`.
- **JSON.** MariaDB's `JSON` is `LONGTEXT` with an automatic `json_valid` check; `information_schema` reports `longtext`. Treated as MySQL, every JSON column would fail verification and the planner would try to change it.
- **Defaults.** MariaDB quotes literal defaults in `COLUMN_DEFAULT`, writes `current_timestamp()`, and has no `DEFAULT_GENERATED`.
- **Types.** MariaDB reports integer display widths (`int(11)`) and has native `UUID`, `INET4` and `INET6`.
- **Syntax.** MariaDB rejects MySQL's `AS new` row alias in upserts and `FOR SHARE`; it has `RETURNING` on `INSERT` and `DELETE` and MySQL has none.
- **Shared:** wire protocol, drivers (the `mariadb` package serves both), `VALUES()` upserts, CTEs, window functions, identifier rules, implicit commit on DDL. That much sharing suits subclassing.

Hibernate makes the same split (`MariaDBDialect extends MySQLDialect`). TypeORM and Sequelize distinguish the two as well.

**Assumptions.** MariaDB 10.11 is the floor. The Prisma 7 reader for both targets accepts `provider = "mysql"`, because Prisma 7 used that one provider for both and the project config already says which target applies.

**Rejected.** *One `mysql` target with a MariaDB adapter option*: the data types would be shared, so a MariaDB JSON column could not verify, and relation loading would still need a different SQL shape.

## 4. Writes return rows without `RETURNING`

**Today.** Every ORM write that returns rows asserts the `returning` capability (`assertReturningCapability`, `sql-orm-client/src/collection-contract.ts`). The write returns its identity columns through `RETURNING`; the ORM then reads the rows back through the read path, keyed by `identity IN (...)`, in the same transaction (`collection-dispatch.ts`, `#reloadMutationRowByIdentity` in `collection.ts`). `delete` already reads its snapshot before deleting. A mutation graph with more than one statement runs in a transaction (`mutation-graph/run-graph.ts`).

**Decision.** On a target without `RETURNING` for a statement, the identity comes from somewhere else:

- `create`: the key values the client generated, or the insert id the driver reports. A multi-row insert relies on MySQL assigning consecutive ids, which the project checks on a live server.
- `update`: select and lock the matching keys first, update by those keys, then read back. This also covers an update that changes the key.
- `delete`: unchanged.

The `returning` capability splits by statement (insert, update, delete), because MariaDB has it for insert and delete only. `SqlStatementStats` gains the last insert id.

**Why.** Will, 2026-10-22: consistent with the principles, because the user asked the ORM for the rows. The read-back machinery exists, so the change is limited to finding the identity.

**Rejected.** *Refuse every row-returning write on MySQL*, leaving only the `*AndCount` methods: keeps one statement per call but makes the ORM close to unusable.

## 5. What a failed migration leaves is stated by the target's runner

**Today.** `SqlMigrationRunner.execute` promises that a failure on any space rolls back every space's writes (`packages/2-sql/9-family/src/core/migrations/types.ts`), and the CLI and ADR 212 repeat it. `db sign` creates the marker table inside the transaction that writes markers.

**Decision.** Whether a failed apply rolls back is stated by the target's runner, per run, in its failure (`databaseUnchanged`, `failingSpace`, and its message). The MySQL runner applies and verifies one space at a time and writes each space's marker only after verification passes, like the Mongo runner. Re-running a failed apply resumes. Operations keep their postchecks, so a re-run skips what was applied.

**Why.** MySQL commits implicitly on every DDL statement. The promise cannot hold there; this is forced, not chosen. The Mongo family already documents and implements the same model.

**Revised in slice 2b (2026-10-22).** A static `applyAtomicity: 'all-spaces' | 'per-space'` field on the migrations capability was built and then removed after review: its only reader repeated what the failure already says, and `'per-space'` wrongly suggested each space applies all or nothing (only the marker write is atomic; operations that ran stay applied). `db sign`'s order became the adapter's choice (`holdMarkerLock`), because moving the marker-table setup out of the lock for every target opened a race on Postgres. MySQL's `GET_LOCK` holds per session, so the adapter releases it explicitly, and a failed release never hides the error that ended the work.

## 6. Decided while shaping slice 2 (2026-10-22)

These were decided by the orchestrator from the slice 2 research, under Will's instruction to settle representation details without escalating.

- **A PSL enum on MySQL is a native `enum('A','B')` column type.** The database enforces membership, which is Will's rule of 2026-09-29 ("Prisma 8 adds the membership constraint to the database"). It is what MySQL users and Prisma 7 already have, introspection reads it from `COLUMN_TYPE`, and member drift shows up as column type drift. It reuses the column's value-set slot, so no shared concept is added. Rejected: `varchar` with a derived CHECK (works, but no MySQL user would recognise it, and Prisma 7 schemas could not be adopted without a change); `varchar` with no enforcement, as SQLite does (loses the invariant that ADR 244 protects); a named enum entity (MySQL has no `CREATE TYPE`).
- **How the members reach the column (decided while building 2a).** The target's column-type hook only sees the codec and its parameters, never the value set, and only the TypeScript builder calls it. So the target's namespace factory, which PSL lowering, `defineContract` and loading an emitted contract all pass through, derives the column's `typeParams.values` from the value set the column names and refuses a contract where they differ. The data type `mysql/enum` is named by its catalog text, so `db verify` compares `enum('A','B')` with MySQL's `COLUMN_TYPE` exactly ([ADR 273](../../docs/architecture%20docs/adrs/ADR%20273%20-%20A%20column%20of%20a%20type%20no%20data%20type%20claims%20is%20a%20raw%20column.md) names the same catalog-text rule).
- **`String` maps to `varchar(191)`.** MySQL needs a key length to index a `TEXT` column, so a `@unique String` on `text` fails. 191 characters is what Prisma 7 uses, so adopted databases keep their columns.
- **No namespaces on MySQL in this project.** The target reports `supportsNamespaces: false` and the unbound default namespace, as SQLite does. Mapping namespaces to MySQL databases is later work.
- **Slice 2 splits in two.** The research sized it at 10–13k lines. 2a: target, codecs, driver, facade, emit, introspection, CI. 2b: planner, runner, verify, sign, atomicity.

## 7. Decided while shaping slice 3 (2026-10-23)

- **A to-many include keeps its order with `GROUP_CONCAT(… ORDER BY …)`.** The MySQL manual says the element order of `JSON_ARRAYAGG` is undefined, and that the optimizer ignores a derived table's `ORDER BY` when the outer query aggregates, so neither keeps related rows in order. `GROUP_CONCAT` honours its own `ORDER BY`. The adapter builds the JSON array text with it and casts the result to JSON. A statement that uses `GROUP_CONCAT` carries a `SET_VAR(group_concat_max_len = …)` optimizer hint, so the SQL does not depend on a session setting. An empty array is written only when the include matched no rows; if the array text is NULL for any other reason (for example a result larger than `max_allowed_packet`, where MySQL returns NULL with only a warning), the cast fails the statement instead of returning an empty list. It needs no shared change. Rejected for now: carrying a sort key in each JSON object and sorting in the runtime's decoder, which needs a shared change and a new capability; it is the fallback if live tests show the chosen form breaks.
- **Coupling rows 10, 11 and 26 wait.** Capability checks already refuse `distinctOn` and the Postgres-only lock strengths on MySQL, so neither blocks reads. Row 26 does not block reads. (The integer parameter casts this bullet once described are removed by section 8: the driver sends integers as BIGINT.)
- **Parameters are numbered.** The MySQL renderer writes `?N`, where N is the parameter's place in the runtime's parameter list. SQLite had the same parameter-order bug and got the same fix on `main`. The driver rewrites them to `?` and orders the values to match (section 8).

## 8. The MySQL driver (2026-10-27, approved 2026-10-28, revised 2026-10-28; replaces the mysql2 design of 2026-10-23)

This section describes how the MySQL runtime driver and control driver talk to the server. It replaces an earlier design built on the `mysql2` package. Facts come from the `mariadb` package's source (3.4.5 and 3.5.4), its issue trackers, Prisma 7's adapter, and probes against a MySQL 9.6 server; the research notes are `wip/research-mysql-protocol.md` and `wip/research-mariadb-driver.md` in the slice's worktree.

### The package: `mariadb`, for MySQL and MariaDB

Both drivers use the `mariadb` npm package, version 3.5.4 or later (pinned at 3.5.4), for MySQL and for MariaDB. Prisma 7's `@prisma/adapter-mariadb` uses it for both. Prisma chose it in June 2025 after a `mysql2` adapter was built and abandoned: `mysql2` held about 40 MB more for every test and never released it (Linear TML-761, closed 2025-06-20; TML-1129: "it's just too unreliable … we're pivoting to the `mariadb` driver for both MySQL and MariaDB"). 3.5.4 is the floor because earlier versions corrupt rows when a type conversion asks for a column's text under prepared statements (CONJS-363), and hang without pipelining (CONJS-361).

### Revised 2026-10-28: copy the Postgres driver

The second review measured this section against Will's rule of 2026-10-28: the MySQL target uses the Postgres target's patterns, and differs only where MySQL forces it. The subsections below describe the driver after that revision. Each difference from Postgres says what forces it.

### Statements, and values never inside SQL text

Every statement that carries values runs as a server-side prepared statement: the SQL goes to the server with `?` placeholders, the server parses it, and the values follow separately. The driver never writes a value into SQL and never uses the package's client-side escaping. This is the decision Will made on 2026-10-23 after three reviews found injections in client-side escaping.

A statement without values runs over the text protocol on both drivers, as `pg` runs one on Postgres (it prepares only when there are values). Nothing is written into such a statement, and multiple statements are off, so there is nothing to inject. This lets raw `START TRANSACTION`, `LOCK TABLES` and the other statements MySQL refuses to prepare (error 1295) run, on the runtime as in migrations.

### Placeholders: numbered by the renderer, rewritten by the driver (Will, 2026-10-28)

The renderer handles parameters exactly as the Postgres and SQLite renderers do. It numbers each parameter node once, in the order the runtime encodes values (`collectOrderedParamRefs`), and writes that number wherever the node appears. Postgres writes `$N` and SQLite writes `?N`, which the server reads directly. MySQL's `?` cannot carry a number and takes values by position, so the MySQL renderer writes `?N` and the driver turns each `?N` into `?`, listing the values in placeholder order (a parameter written twice is sent twice). The driver reads the SQL with a MySQL lexer that skips strings, comments and quoted identifiers, so a `?1` inside a string in raw SQL is left alone. Nothing changes in the SQL family.

Rejected: a SQL family change in which the lowered statement lists, in written order, which parameter each placeholder takes. It adds a field to the shared adapter-to-driver contract for one target.

### No statement reuse

Each prepared statement is closed after it runs (`prepareCacheLength: 0`). Postgres reuses a statement only through the user's prepared-statement handle (ADR 210), keeping it open on the connection for the handle's life; ADR 210 lets a driver ignore the handle, and the MySQL driver does, for two reasons MySQL forces. MySQL caps open prepared statements across all connections of the server (`max_prepared_stmt_count`, 16,382 by default), and a statement kept per handle on every pooled connection has no limit of its own; Prisma 7 left the package's cache on in 7.5.0 and users hit the cap within two weeks (prisma/orm#29361, #29364), and 7.x then set it to 0 (#29392). And since MySQL 8.0.22 a reused statement keeps the parameter types of its first run, so a value sent later as another type is converted: a probe stored `'9007199254740993'` as `9007199254740992` after a first run with a fraction. The `statementCacheSize` URL parameter of the first draft, a cache keyed on SQL text, which ADR 210 rejected, is gone. The cost is one extra round trip per statement on MySQL (prepare, execute, close); MariaDB sends prepare and execute together.

### Sending values

Codecs return what the database reads for each data type, as the Postgres codecs do: the `int` codec a number, the `bigint` codec decimal text (as `pg/int8@1`), a boolean as a boolean. The adapter writes every parameter as a bare `?N`, as the Postgres adapter writes `$N` for every data type whose type the server infers from where the parameter stands, the integers among them. MySQL infers the same way (8.0.22 and later): a decimal text parameter beside a `bigint` column is compared and stored exactly. Where nothing gives a parameter a type, as in `?1 + ?2` in raw SQL, the author writes the cast, as on Postgres. `LIMIT ?` takes only a bare placeholder, so a cast could not go there anyway.

The binary protocol gives each value a wire type, which `pg` never has to choose, so the driver's `parameter-values.ts` has rules for the JavaScript values the package mis-sends (all from its source, confirmed by probe):

- A number is sent as INT only between −2^31 and 2^31 − 2, and otherwise as DOUBLE, so `LIMIT ?` with 2147483647 fails. The driver sends an integer number as a BIGINT, so an integer's wire type does not change with its size, and any other number as the DOUBLE it is.
- A `bigint` below −2^63 makes the package throw inside its socket callback, which crashes the process. The driver refuses a `bigint` outside the signed 64-bit range before sending, without the value in the error.
- A `Date` is encoded in the process's local time zone whatever the `timezone` option says. The MySQL codecs send dates as text; the driver refuses a `Date`.
- A `Uint8Array` that is not a Node `Buffer` is sent as JSON text. The driver wraps it as a `Buffer`.

### Reading values

Both drivers return every row value in the form ADR 155 sets: text, a `Uint8Array` for bytes, or `null`. The Postgres driver gives `pg` a type parser that returns the server's text; the MySQL drivers give the `mariadb` package one `typeCast` function, `readTextOrBytes`, which reads a binary-collation string or blob, BIT, GEOMETRY and any type the package has no name for (MySQL 9's VECTOR) as bytes, and every other column as text. No codec sees a `bigint`, a `number`, a `Date` or a `Buffer`.

Over the text protocol MySQL writes the text; under a prepared statement MySQL sends numbers, dates and times in binary and the package writes them (3.5.4, `binary-decoder.js`). For five kinds of column the two differ, and since both drivers use both protocols, `readTextOrBytes` gives each the form MySQL writes over the text protocol, as Postgres returns every value as the server writes it: YEAR and a ZEROFILL integer padded to the column's width, a TIME with the column's fraction digits, a FLOAT and a DOUBLE. For a FLOAT or a DOUBLE the driver reads the number the server sent, whichever the protocol, because the package's text for a binary number differs from MySQL's in digits, notation and the sign of zero (it writes negative zero as `0`). MySQL writes a FLOAT with six significant digits, rounded half to even, and a DOUBLE with the fewest digits that read back as the same double, which are the digits JavaScript prints. Both use one notation: fixed, unless that needs more than 14 zeros after the point, or more than 15 digits before it with none after it (`0.1`, `0.000000000000001`, `1e-16`, `4233813289058719.5`, `1e15`, `1e20`); negative zero is `-0`. A column declared with decimals, such as `FLOAT(12,6)` or `DOUBLE(10,2)`, reports them as the column's scale on both protocols (31 means none). MySQL writes its value with exactly those decimals in fixed notation, reading a FLOAT's value as a double: the fewest digits that read back as the same double, padded with zeros when they fit, and otherwise the exact value rounded to them, half to even. So a `FLOAT(12,6)` holding 1234.5677 reads `1234.567749` and a `DOUBLE(10,2)` holding 1.5 reads `1.50`. Negative zero, which a computed column such as `-price` can hold, reads `-0.00` as MySQL writes it. MariaDB reports 39 for no declared decimals, so the MariaDB target must check that value. A probe of 54,992 FLOAT and DOUBLE values on MySQL 9.6, random bit patterns, subnormals, ties, both zeros and the notation boundaries among them, found the driver's text equal to MySQL's from both protocols. A second probe (`wip/f02/probe-declared.mjs` in the slice's worktree) did the same for 56,070 values in 14 FLOAT and DOUBLE columns declared with 0 to 30 decimals. DECIMAL, JSON, ENUM and SET arrive as MySQL's own text. The live tests read every column type on a pooled and a held connection, over the text protocol and prepared, and the five kinds through both drivers with and without values.

### Connections and the session

The target declares the session settings its codecs need, as the Postgres target declares `DateStyle`: `sessionSettings: { time_zone: '+00:00' }`, because the datetime codec reads and writes UTC. The stack passes them to both drivers. The package runs the driver's own session setup once per physical connection through `initSql`: `sql_mode` without `NO_BACKSLASH_ESCAPES` and `ANSI_QUOTES`, and utf8mb4, which the driver's lexer needs. These hold no value. The target's settings do, so they never go into SQL text: the runtime driver sets them with one prepared `SET SESSION` the first time it takes each physical connection from the pool, as the Postgres driver's `SessionSettingsGuard` sets them with `set_config($1, $2)` on a pool whose sessions it did not start, and the control driver sets them the same way after it connects. Postgres can also put them in a connection's startup options; MySQL has no such thing. A value of decimal integer text is sent as a number, because MySQL refuses text for an integer variable even in a prepared `SET`, where Postgres's `set_config` takes text for every setting. A setting MySQL refuses fails the statement at once with MySQL's error, and the connection is destroyed.

A connection goes back to the pool after each statement, as it is. There is no reset on release: the package's `resetAfterUse` is ignored on MySQL (it sends `COM_RESET_CONNECTION` only to MariaDB), and no other driver or ORM resets by default (Drizzle, Kysely, node-postgres, Rails; `mysql2` added an opt-in in 2026). A raw `SET` a user runs stays on that connection for its lifetime, as on Postgres.

The pool is sized and timed as the Postgres facade sizes `pg.Pool`, through `poolOptions` on `mysql()`: it opens a connection only when one is needed (`minimumIdle: 0`; the package's default fills the pool at once), closes one idle for `idleTimeoutMillis` (30 seconds), and waits `connectionTimeoutMillis` (20 seconds) both to open a connection and for a pooled one to come free. `max` sets the size (10). The Postgres facade has no `max`: a Postgres user who needs another size passes a `pg.Pool` they built. The MySQL driver cannot take a pool the caller built, because it depends on behaviour fixed when each connection signs in, which it can neither set nor check on such a pool: `foundRows` (whether an UPDATE's affected rows count matched rows, as Postgres counts them), `multipleStatements` and `permitLocalInfile` are capability flags of the sign-in. So the driver builds its pool, and `max`, named as `pg.Pool`'s own, is how its size is set. The facade refuses a URL whose scheme is not `mysql://`, as the Postgres facade refuses one that is not `postgres://`.

TLS settings are the URL parameters `pg-connection-string` reads for Postgres: `ssl`, `sslmode`, and `sslcert`, `sslkey` and `sslrootcert` as PEM file paths. The driver ignores any other parameter, as `pg` does; the package never sees the URL, so a parameter cannot turn on one of its options. Two are refused, because the driver cannot do what they ask: `charset`, because every connection must be utf8mb4 for the lexer, where `pg` honours `client_encoding`; and `sslcert` without `sslkey`, because in a Prisma 7 MySQL URL `sslcert` named the CA file that checks the server, which `pg` calls `sslrootcert`, and the message says so. The package never follows a server's redirect to another host (`permitRedirect: false`), which it does by default over verified TLS when MariaDB 11.3 or later asks; `pg` never follows one.

Other pool facts the driver relies on: the pool's `'error'` event needs a listener; a lost connection fails the running statement with `fatal: true`, which the driver reports as a transient `SqlConnectionError`, as Postgres does; the pool keeps retrying a connection it cannot open until its timeout, pausing 200 ms longer after each failure, up to 10 seconds, but reports each failed connection to its `logger.error` at once. `logger.error` also receives every failed statement, so the driver reacts only to an error the package marks fatal that no retry gets past: a refused connection, an unknown or unreachable host, a refused sign-in, a missing public key, or failing session setup. A statement can fail with a sign-in's error number, such as 1524 for a missing authentication plugin, but never fatally. On such a failure the driver fails the statements waiting for a connection at once, as `pg.Pool` rejects a pending connect whose connection fails. It keeps no failure, as `pg.Pool` keeps none: a later statement asks the pool for a connection and fails only when the pool's next attempt fails. Here the package differs from `pg.Pool`, which makes a new attempt for each connect at once. The package's retries and pauses are fixed, and the driver does not work around them, so while the server stays unreachable each later statement waits for the pool's next attempt and fails when it fails. Within one attempt, which lasts `connectionTimeoutMillis` less 100 ms, the package retries a refused connection or an unknown host every 500 ms; a refused sign-in ends the attempt at once. After each failed attempt it pauses 200 ms longer than after the one before, up to 10 seconds. Measured on MySQL 9.6 with statements sent one after another: after a refused sign-in, 6 ms for the first statement, then 202, 403, 604 and so on up to 1,403 ms for the eighth; after a refused connection, about 500 ms each with the default 20 seconds, and from 0 to 1,002 ms with `connectionTimeoutMillis: 1000`, once the pauses between attempts apply. The package has no way to remove a request from its queue, so a statement the driver fails leaves its request there until the pool serves it or `connectionTimeoutMillis` ends. The driver returns a connection the pool hands to such a request straight to the pool: after 500 statements failed against a refused port, 500 requests stayed queued, and once the server accepted connections the next statement ran after 589 ms, behind them. The pool makes no attempt while no statement waits. So once the cause is fixed, the next statement makes the attempt and runs, after any pause still under way ends. A failure a retry can get past, such as a reset connection or a connect timeout, still waits for the pool's retries until `connectionTimeoutMillis`, because the package reports it in the same way as a statement that lost its connection. A refused sign-in is the `SqlQueryError` MySQL raised, as Postgres reports 28P01; a missing public key and failing session setup are a `SqlConnectionError` that is not transient; a Node socket or DNS error is a `SqlConnectionError`, transient as the Postgres driver's table says (a refused connection and an unknown or unreachable host are not); `pool.end()` waits up to 10 seconds for borrowed connections, then destroys them, so `close()` waits for streams and held connections itself first.

### Reading whole results, and streams

A query reads its whole result and returns its connection before the first row, as the Postgres facade does by default (`cursor: { disabled: true }`), so a statement awaited inside the loop over a query in a transaction runs. `stream: true` on `mysql()` streams rows as they arrive, through `executeStream` (or `queryStream` without values), which pauses the socket while the consumer is busy; it is the counterpart of Postgres's `cursor` option. It is a boolean, not `cursor: { batchSize }`, because MySQL has no server-side cursor for a query: the server sends the whole result and the driver reads it from the socket as the caller asks for rows, so there is no batch to size. `mysql()` checks it with arktype when it is called, as `postgres()` checks `cursor`.

Statements on a held connection reach the server in the order they are sent, under a copy of the Postgres driver's per-client lock: a statement holds its client's lock until it settles, and a stream for its whole life. Without it, a rollback sent while a prepared statement waited for MySQL's answer to its prepare ran first (confirmed by probe), because the package queues the execution only after that answer. While a stream is open, a statement sent on its connection waits for the stream to end, and one awaited inside the stream's own loop never finishes, as on Postgres with a cursor.

MySQL cannot cancel a running statement on the same connection. When the caller stops a pooled stream early and the whole result has already arrived, the driver drops the buffered rows and returns the connection to the pool. When rows are still arriving, it destroys the connection, so a large result is not downloaded only to be thrown away; the package then opens one short connection to send `KILL`. On a held connection the driver reads and drops the rest. Releasing a held connection with a statement still running destroys it: the package's release sends `ROLLBACK` behind the running statement and waits for it, where `pg`'s release does not wait on the server.

### Authentication

MySQL 8.4's default `caching_sha2_password` fails over plain TCP unless TLS is used or the client may fetch the server's key (`allowPublicKeyRetrieval`). The URL accepts an `allowPublicKeyRetrieval` parameter, off by default, and the error for the failure names both ways out. It arrives at once and is not transient.

### What this removes from the slice

`mysql2` and its typings; the `CAST(? AS SIGNED)` integer casts and the raw-SQL `LIMIT`/`OFFSET` detection; the driver's statement cache code and its bound checks. The placeholder lexer stays, in the driver only.

### Rejected

- **`mysql2`.** Prisma abandoned it in 2025 for memory growth; it sends a `BigInt` as text, which forced the integer casts; it needs 3.24.0 (August 2026) for `LIMIT ?` with numbers.
- **The text protocol for statements with values**, as Drizzle and Kysely use. It writes values into SQL on the client, which is what this design exists to avoid.
- **A statement cache**, keyed on SQL text or on the prepared-statement handle: the server-wide limit and the parameter-type problem above.
- **Reset on release.** Ignored on MySQL by this package.
- **Streaming by default.** It made a statement awaited inside the loop over a query hang where Postgres runs it.

## Settled by testing in the proof of concept

These are SQL-shape details the slices decide against a live server, and record here.

- How MySQL keeps related rows in order, since `JSON_ARRAYAGG` takes no `ORDER BY`.
- How MariaDB loads relations without `LATERAL`.
- Whether a multi-row insert's ids are consecutive under MySQL's default auto-increment lock mode.
- Whether an `UPDATE` or `DELETE` whose subquery reads the same table (MySQL error 1093) occurs in the ORM's statements.
