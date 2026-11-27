# Prior art: writes that return rows, in TypeScript ORMs and query builders

Researched 2026-11-24. Source links point at the commit read on that day:

- prisma-engines `d1b3f377ca835d73fd50954a5e22128b9ebdd6b8` (main, the query compiler that Prisma 7's TypeScript client engine runs) and tag `5.22.0` (the Rust query engine of Prisma 5/6).
- drizzle-orm `3bcb6a27ec1f4f1602aeeb0af2f5aec61010d72d`, kysely `a5bd19a8ebe2a6c22d4901b6cc7b9082b1419a76`, typeorm `911177c2d68511e0a75ffe189644e7def0c8d830`, mikro-orm `d19dc8a66295ee68b749501bc2aa3ab315426f44`, sequelize v6 `516c6635a86152270471fbfad11d38cc91e9ee15` and main (v7) `6f4cca6a74639b5d057f3823359489b52902191e`, node-mysql2 `727c4120ad0ca192a7fca8a44d237986be472cd9`.

Markers: **(verified in source/docs)** means I read it in the linked file or page. **(inferred from source)** means I read the code but the conclusion combines several pieces and I did not run it. **(from memory, not verified)** means I did not find it in a source this session.

A fact that matters for every library: the `mysql2` driver turns the `CLIENT_FOUND_ROWS` flag on by default ([`getDefaultFlags`](https://github.com/sidorares/node-mysql2/blob/727c4120ad0ca192a7fca8a44d237986be472cd9/lib/connection_config.js#L286-L289)) **(verified in source/docs)**, so on MySQL `affectedRows` counts rows the `WHERE` matched, not only rows whose values changed, unless a library turns the flag off.

---

## Prisma ORM 5 to 7

Prisma 5 and 6 build a query graph in the Rust query engine and run it there. Prisma 7's TypeScript client engine uses the same graph builder, now in `query-compiler/core`, and the query compiler turns each graph node into an expression that the TypeScript runtime executes. The graph-building code for `delete` and `update` is the same shape in 5.22 and on main **(verified in source/docs)**.

### 1. Which writes return rows, and how

- `create`, `update`, `delete`, `upsert` return the record; `updateMany`, `deleteMany`, `createMany` return `{ count }`; `createManyAndReturn` and `updateManyAndReturn` return records. The client reference says both `…AndReturn` methods are "Supported for PostgreSQL, CockroachDB, and SQLite" ([client reference](https://www.prisma.io/docs/orm/reference/prisma-client-reference)) **(verified in source/docs)**.
- On MySQL the `…AndReturn` methods do not exist in the generated client at all: the schema builder only adds `createManyAndReturn` when the connector has `InsertReturning`, and `updateManyAndReturn` when it has `UpdateReturning` ([`mutation_type.rs` L28-L43](https://github.com/prisma/prisma-engines/blob/d1b3f377ca835d73fd50954a5e22128b9ebdd6b8/query-compiler/schema/src/build/output_types/mutation_type.rs#L28-L43)) **(verified in source/docs)**. So the refusal is at type level, by omission.
- Capabilities per connector: PostgreSQL has `NativeUpsert`, `InsertReturning`, `UpdateReturning`, `DeleteReturning` ([postgres connector L68-L73](https://github.com/prisma/prisma-engines/blob/d1b3f377ca835d73fd50954a5e22128b9ebdd6b8/psl/psl-core/src/builtin_connectors/postgres_datamodel_connector.rs#L68-L73)); SQLite has the same four ([sqlite connector L28-L33](https://github.com/prisma/prisma-engines/blob/d1b3f377ca835d73fd50954a5e22128b9ebdd6b8/psl/psl-core/src/builtin_connectors/sqlite_datamodel_connector.rs#L28-L33)); MySQL has none of them ([mysql connector](https://github.com/prisma/prisma-engines/blob/d1b3f377ca835d73fd50954a5e22128b9ebdd6b8/psl/psl-core/src/builtin_connectors/mysql_datamodel_connector.rs)) **(verified in source/docs)**. The capability enum is in [`capabilities.rs` L105-L110](https://github.com/prisma/prisma-engines/blob/d1b3f377ca835d73fd50954a5e22128b9ebdd6b8/psl/psl-core/src/datamodel_connector/capabilities.rs#L105-L110).

**`delete({ where })`** ([`delete_record`, `delete.rs` L16-L112](https://github.com/prisma/prisma-engines/blob/d1b3f377ca835d73fd50954a5e22128b9ebdd6b8/query-compiler/core/src/query_graph_builder/write/delete.rs#L16-L112)) **(verified in source/docs)**:

- With `DeleteReturning` (PostgreSQL, SQLite), no nested selection, and no relation filter that needs a join (`can_use_atomic_delete`, [L170-L185](https://github.com/prisma/prisma-engines/blob/d1b3f377ca835d73fd50954a5e22128b9ebdd6b8/query-compiler/core/src/query_graph_builder/write/delete.rs#L170-L185)): one node, `DELETE … RETURNING`. A following empty "check" node raises the not-found error if the `RETURNING` produced no row. Not transactional unless relation-mode emulation adds nodes.
- Otherwise (MySQL, or a nested `include`): the graph is flagged transactional; a `findUnique` read with the same filter runs first; then a `DELETE` with the same filter and no selection. The edge from read to delete carries the "non-empty rows" expectation, so the not-found error comes from the **read**. The read node is the result. The comment in the source says the read and delete "use the same filter" and the "whole operation is executed in a transaction", so if the read found nothing the delete would not either.
- In Prisma 4.16 the delete was always read-then-delete in a transaction; the `RETURNING` path is new in 5.x ([4.16 `delete.rs`](https://github.com/prisma/prisma-engines/blob/4.16.0/query-engine/core/src/query_graph_builder/write/delete.rs)) **(verified in source/docs)**.

**`update({ where, data })`** ([`update_record`, `update.rs` L17-L107](https://github.com/prisma/prisma-engines/blob/d1b3f377ca835d73fd50954a5e22128b9ebdd6b8/query-compiler/core/src/query_graph_builder/write/update.rs#L17-L107)) **(verified in source/docs)**:

- With `UpdateReturning`, no nested selection and no nested writes (`can_use_atomic_update`, [L312-L334](https://github.com/prisma/prisma-engines/blob/d1b3f377ca835d73fd50954a5e22128b9ebdd6b8/query-compiler/core/src/query_graph_builder/write/update.rs#L312-L334)): one `UPDATE … RETURNING`; an empty check node raises not-found when no row came back.
- Without `UpdateReturning` (MySQL): (a) a read of the primary key with the unique filter (`read_id_infallible`); the edge into the update carries the non-empty expectation, so the not-found error comes from this read; (b) `UPDATE … WHERE id IN (<ids from a>) AND <original filter>` (the selectors are ANDed with the filter: [`generate_update_statements`, `sql-query-builder/src/write.rs` L236-L256](https://github.com/prisma/prisma-engines/blob/d1b3f377ca835d73fd50954a5e22128b9ebdd6b8/query-compiler/query-builders/sql-query-builder/src/write.rs#L236-L256)); (c) a `findUnique` read by id that becomes the result. Flagged transactional.
- The update in step (b) returns nothing useful on MySQL. In the query compiler, `UpdateRecordWithoutSelection` is translated to an `Execute` wrapped in `InitializeRecord`, which builds the result record from the ids that came **in** (the selectors), not from the database ([`translate/query/write.rs` L194-L255](https://github.com/prisma/prisma-engines/blob/d1b3f377ca835d73fd50954a5e22128b9ebdd6b8/query-compiler/query-compiler/src/translate/query/write.rs#L194-L255), comment: "This case is used for databases with no support for the `RETURNING` clause"). In 5.22 the Rust engine does the same: `let (_, ids) = update_many_from_ids_and_filter(…)` discards the affected-row count and returns the ids it was given ([`update_one_without_selection`, 5.22 `update.rs` L56-L91](https://github.com/prisma/prisma-engines/blob/5.22.0/query-engine/connectors/sql-query-connector/src/database/operations/update.rs#L56-L91)) **(verified in source/docs)**.

**`upsert`** ([`upsert.rs` L11-L76](https://github.com/prisma/prisma-engines/blob/d1b3f377ca835d73fd50954a5e22128b9ebdd6b8/query-compiler/core/src/query_graph_builder/write/upsert.rs#L11-L76)): with `NativeUpsert` and the documented conditions (no nested queries, one model, `where` has one unique field whose value equals the one in `create`), one `INSERT … ON CONFLICT … DO UPDATE`. Otherwise: read, then an if-node that runs update or create, then a read **(verified in source/docs)**. MySQL never gets the native form (no `NativeUpsert`).

**`deleteMany`/`updateMany` with `limit`** (added in Prisma 6): `id IN (SELECT id FROM t WHERE … LIMIT n)` ([`limit.rs`](https://github.com/prisma/prisma-engines/blob/d1b3f377ca835d73fd50954a5e22128b9ebdd6b8/query-compiler/query-builders/sql-query-builder/src/limit.rs)); there is no `orderBy` argument, only `where` and `limit` are read ([`delete_many_records` L115-L161](https://github.com/prisma/prisma-engines/blob/d1b3f377ca835d73fd50954a5e22128b9ebdd6b8/query-compiler/core/src/query_graph_builder/write/delete.rs#L115-L161)) **(verified in source/docs)**. See question 6 for MySQL.

### 2. Emulation on MySQL: locks, transaction, re-check, counts

- **Transaction:** yes, every emulated path calls `graph.flag_transactional()` **(verified in source/docs)**. The graph builder sets no isolation level, so the database default applies (REPEATABLE READ on MySQL InnoDB) **(from memory, not verified)**.
- **Row locks:** none. I searched the SQL query builder and the quaint AST/visitors for `FOR UPDATE`, `lock` and `SKIP LOCKED`; the only hits are test names. The pre-read is a plain `SELECT` **(verified in source/docs)**. Locking reads are an open feature request: [#8580 "`SELECT FOR UPDATE`"](https://github.com/prisma/prisma/issues/8580) and [#17136 "Row locking support in `find*()` queries"](https://github.com/prisma/prisma/issues/17136), both open **(verified in source/docs)**.
- **Re-check the filter in the write:** yes. The `UPDATE`/`DELETE` keeps the original filter and adds `id IN (…)` from the pre-read **(verified in source/docs)**.
- **Compare affected-row counts:** no, for `update` and `delete`. The count is discarded (see above), and the not-found error (`P2025`, "Record to update/delete does not exist") is raised from the **pre-read** being empty, or, on the `RETURNING` path, from `RETURNING` producing no row **(verified in source/docs)**.
- **What happens when the row changes between the statements:** the race is accepted. Two consequences follow from the source **(inferred from source)**: a `delete` can return a record that another connection deleted first (our `DELETE` affects 0 rows, but the result is the pre-read row); an `update` whose filter stops matching returns a record although nothing was updated. The second is reported in [#19233 "`update` doesn't signal that a record wasn't found when using `extendedWhereUnique`"](https://github.com/prisma/prisma/issues/19233) (MariaDB, open): two workers claim a row with `update({ where: { id, version } })`; a maintainer reproduced that the loser gets "the old version of the record instead of" an error, and recommended `updateMany` plus a check of `count` **(verified in source/docs)**. That the loser sees the old row is consistent with the final read running inside a REPEATABLE READ snapshot taken by the pre-read **(inferred from source)**.
- **Upsert races:** the reference docs say that without a database upsert, concurrent upserts can fail with a unique-constraint error (`P2002`) and advise catching it and retrying ([client reference, upsert](https://www.prisma.io/docs/orm/reference/prisma-client-reference)) **(verified in source/docs)**. Reported on MySQL in [#25081](https://github.com/prisma/prisma/issues/25081) (open) **(verified in source/docs)**.

### 3. "Update or delete the first row matching a filter and order"

- No such call. `update`/`delete` take a unique `where` only; `updateMany`/`deleteMany` take `where` and `limit` but no order **(verified in source/docs)**. Requests are open: [#4349 "Add `deleteFirst()` and `updateFirst()`"](https://github.com/prisma/prisma/issues/4349), [#14445 "`updateFirst` function"](https://github.com/prisma/prisma/issues/14445) **(verified in source/docs)**.
- Documented idiom: optimistic concurrency control. The transactions page reads a row, then `updateMany({ where: { id, version }, data: { …, version: { increment: 1 } } })`, and throws if `count === 0`; it describes this as not relying on locking ([Transactions, "Optimistic concurrency control"](https://www.prisma.io/docs/orm/prisma-client/queries/transactions?view=full#optimistic-concurrency-control)) **(verified in source/docs)**. The docs do not mention `FOR UPDATE` or `SKIP LOCKED`; users fall back to `$queryRaw` **(verified in source/docs for the absence; raw SQL fallback from memory, not verified)**.

### 4. Affected-row-count checks

- `P2025` for `update`/`delete` is based on the pre-read or on `RETURNING` output, never on the affected-row count **(verified in source/docs)**. The OCC idiom puts the count check in user code **(verified in source/docs)**. Because the count is unused for `update`/`delete`, found-rows versus changed-rows semantics do not affect `P2025`. `updateMany`'s `count` on MySQL does depend on them; I did not check which flag the Rust MySQL driver or the Prisma 7 MariaDB adapter sets **(not verified)**.

### 5. Capability handling

- Connector capabilities (bit flags declared per connector) are checked while the query graph is built (`query_schema.has_capability(...)` in `delete_record`, `update_record`, `upsert_record`, and in the schema builder that decides which client methods exist) **(verified in source/docs)**. The builder picks the final shape per call at build time: one `… RETURNING` node, or read → write → read nodes with data-dependency edges and a "non-empty rows" expectation that produces `P2025`. I found no pass that builds a general multi-statement form and then collapses it; the choice is made up front. The query compiler only short-cuts single nodes (an update with no data becomes a read or a no-op) ([`write.rs` L183-L190, L229-L234](https://github.com/prisma/prisma-engines/blob/d1b3f377ca835d73fd50954a5e22128b9ebdd6b8/query-compiler/query-compiler/src/translate/query/write.rs#L183-L234)) **(verified in source/docs)**.

### 6. MySQL error 1093

- Prisma works around it in SQL generation. The MySQL visitor in quaint wraps any sub-select that reads the table being updated or deleted in a derived table: `… IN (SELECT tmp_subselect_table.* FROM (SELECT … FROM t …) AS tmp_subselect_table)`, with the comment "MySql will error if a `Update` or `Delete` query has a subselect that references a table that is being updated or deleted" ([`visit_sub_selection`, `quaint/src/visitor/mysql.rs` L324-L349](https://github.com/prisma/prisma-engines/blob/d1b3f377ca835d73fd50954a5e22128b9ebdd6b8/quaint/src/visitor/mysql.rs#L324-L349); tests at L1082-L1118) **(verified in source/docs)**. This also makes the `limit` form `id IN (SELECT … LIMIT n)` legal on MySQL, which otherwise refuses `LIMIT` inside an `IN` subquery; the `deleteMany` limit test has no connector exclusion ([`delete_many.rs` L179-L203](https://github.com/prisma/prisma-engines/blob/d1b3f377ca835d73fd50954a5e22128b9ebdd6b8/query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/top_level_mutations/delete_many.rs#L179-L203)) **(inferred from source)**.

---

## Drizzle ORM

### 1. Writes that return rows

- PostgreSQL and SQLite builders have `.returning()` on insert, update and delete ([`pg-core/query-builders/delete.ts` L221-L225](https://github.com/drizzle-team/drizzle-orm/blob/3bcb6a27ec1f4f1602aeeb0af2f5aec61010d72d/drizzle-orm/src/pg-core/query-builders/delete.ts#L221-L225); [`sqlite-core/query-builders/delete.ts` L244-L248](https://github.com/drizzle-team/drizzle-orm/blob/3bcb6a27ec1f4f1602aeeb0af2f5aec61010d72d/drizzle-orm/src/sqlite-core/query-builders/delete.ts#L244-L248)) **(verified in source/docs)**.
- MySQL builders have no public `.returning()`; calling it is a type error because the method does not exist **(verified in source/docs)**. The MySQL dialect can still render a `returning` clause from internal config ([`mysql-core/dialect.ts` L136-L146](https://github.com/drizzle-team/drizzle-orm/blob/3bcb6a27ec1f4f1602aeeb0af2f5aec61010d72d/drizzle-orm/src/mysql-core/dialect.ts#L136-L146)), but nothing public sets it for update or delete **(verified in source/docs)**.
- MySQL insert has `$returningId()` ([`mysql-core/query-builders/insert.ts` L281-L294](https://github.com/drizzle-team/drizzle-orm/blob/3bcb6a27ec1f4f1602aeeb0af2f5aec61010d72d/drizzle-orm/src/mysql-core/query-builders/insert.ts#L281-L294)). It sends no extra statement: the `mysql2` session computes ids from `insertId` up to `insertId + affectedRows` for an auto-increment primary key, and uses the values Drizzle generated in JavaScript for `$defaultFn` keys ([`mysql2/session.ts` L97-L124](https://github.com/drizzle-team/drizzle-orm/blob/3bcb6a27ec1f4f1602aeeb0af2f5aec61010d72d/drizzle-orm/src/mysql2/session.ts#L97-L124)) **(verified in source/docs)**. This assumes consecutive auto-increment ids (true for a single multi-row insert under InnoDB's default lock mode) **(from memory, not verified)**. Added in v0.32.0 ([release notes](https://orm.drizzle.team/docs/latest-releases/drizzle-orm-v0320)) **(from search result, not opened)**.
- MySQL update/delete resolve to the driver's raw result (`ResultSetHeader` with `affectedRows`) ([`mysql2/session.ts` L39](https://github.com/drizzle-team/drizzle-orm/blob/3bcb6a27ec1f4f1602aeeb0af2f5aec61010d72d/drizzle-orm/src/mysql2/session.ts#L39)) **(verified in source/docs)**.

### 2. Emulation

- None. Drizzle never emulates `RETURNING` with a `SELECT` for update or delete; it simply does not offer it on MySQL **(verified in source/docs)**.

### 3. First-row claim

- No high-level call. MySQL and SQLite update/delete builders expose `.orderBy()` and `.limit()` ([`mysql-core/query-builders/delete.ts` L144-L172](https://github.com/drizzle-team/drizzle-orm/blob/3bcb6a27ec1f4f1602aeeb0af2f5aec61010d72d/drizzle-orm/src/mysql-core/query-builders/delete.ts#L144-L172); update L185-L211), so on MySQL `UPDATE … ORDER BY … LIMIT 1` is one statement; PostgreSQL builders have neither **(verified in source/docs)**. Selects have `.for('update' | 'share', { noWait } | { skipLocked })` ([`mysql-core/query-builders/select.ts` L1026](https://github.com/drizzle-team/drizzle-orm/blob/3bcb6a27ec1f4f1602aeeb0af2f5aec61010d72d/drizzle-orm/src/mysql-core/query-builders/select.ts#L1026); `LockConfig` in `select.types.ts` L155-L163) **(verified in source/docs)**. Locking is not documented yet: [#2875 "Document `SELECT FOR UPDATE` and its variants"](https://github.com/drizzle-team/drizzle-orm/issues/2875) is open **(verified in source/docs)**.

### 4. Affected-row checks

- None. Drizzle has no optimistic-locking feature and never throws on a count **(verified in source/docs for the code read; absence across the whole codebase not exhaustively checked)**. Counts come from `mysql2` with `FOUND_ROWS` on (matched rows) unless the user passes other flags **(inferred from source)**.

### 5. Capability handling

- Separate builder classes per dialect (`pg-core`, `mysql-core`, `sqlite-core`, …), so capability differences are expressed as which methods exist on which class **(verified in source/docs)**. No runtime capability flags, no rewrite pass.

### 6. MySQL 1093

- No workaround found in the MySQL dialect; the database error reaches the user **(verified in source/docs for the dialect file; no issue thread found)**.

---

## Kysely

### 1. Writes that return rows

- One builder for all dialects. `returning`/`returningAll` exist on insert, update, delete and merge for every dialect; the doc comment says "On supported databases like PostgreSQL" ([`returning-interface.ts`](https://github.com/kysely-org/kysely/blob/a5bd19a8ebe2a6c22d4901b6cc7b9082b1419a76/src/query-builder/returning-interface.ts)) **(verified in source/docs)**.
- On MySQL: no compile-time error. The MySQL query compiler does not override the default compiler's `returning` rendering ([`mysql-query-compiler.ts`](https://github.com/kysely-org/kysely/blob/a5bd19a8ebe2a6c22d4901b6cc7b9082b1419a76/src/dialect/mysql/mysql-query-compiler.ts); [`default-query-compiler.ts` L394-L451](https://github.com/kysely-org/kysely/blob/a5bd19a8ebe2a6c22d4901b6cc7b9082b1419a76/src/query-compiler/default-query-compiler.ts#L394-L451)), so `RETURNING` is passed through and MySQL rejects it at run time **(inferred from source)**.
- The adapter flag only decides the result shape: `execute()` returns rows when `query.returning && adapter.supportsReturning`, otherwise `[new DeleteResult(numAffectedRows)]` ([`delete-query-builder.ts` L1061-L1080](https://github.com/kysely-org/kysely/blob/a5bd19a8ebe2a6c22d4901b6cc7b9082b1419a76/src/query-builder/delete-query-builder.ts#L1061-L1080); update L1165) **(verified in source/docs)**. So on MariaDB with the MySQL dialect, `DELETE … RETURNING` would run but Kysely would hand back a `DeleteResult`, not the rows **(inferred from source)**.
- Results: `DeleteResult.numDeletedRows`; `UpdateResult.numUpdatedRows` ("even if not changed") and optional `numChangedRows` (MySQL only) ([`update-result.ts`](https://github.com/kysely-org/kysely/blob/a5bd19a8ebe2a6c22d4901b6cc7b9082b1419a76/src/query-builder/update-result.ts)); `InsertResult.insertId`. The MySQL driver maps `affectedRows`, `changedRows`, `insertId` from the OK packet ([`mysql-driver.ts` L220-L237](https://github.com/kysely-org/kysely/blob/a5bd19a8ebe2a6c22d4901b6cc7b9082b1419a76/src/dialect/mysql/mysql-driver.ts#L220-L237)) **(verified in source/docs)**.
- `executeTakeFirstOrThrow()` on an update/delete without `returning` never throws for zero rows, because `execute()` always returns one result object **(inferred from source)**.

### 2. Emulation

- None **(verified in source/docs)**.

### 3. First-row claim

- No high-level call. `SelectQueryBuilder` has `forUpdate()`, `forShare()`, `forNoKeyUpdate()`, `forKeyShare()`, `skipLocked()`, `noWait()` ([`select-query-builder.ts` L499-L524](https://github.com/kysely-org/kysely/blob/a5bd19a8ebe2a6c22d4901b6cc7b9082b1419a76/src/query-builder/select-query-builder.ts#L499-L524)); update and delete have `orderBy` and `limit` on every dialect (the database decides whether it accepts them) **(verified in source/docs)**.

### 4. Affected-row checks

- None; no optimistic locking **(verified in source/docs for the files read)**.

### 5. Capability handling

- A `DialectAdapter` with flags: `supportsReturning` (true for PostgreSQL and SQLite, false for MySQL), `supportsOutput` (MSSQL), `supportsTransactionalDdl`, `supportsCreateIfNotExists`, `supportsMultipleConnections` ([`dialect-adapter.ts`](https://github.com/kysely-org/kysely/blob/a5bd19a8ebe2a6c22d4901b6cc7b9082b1419a76/src/dialect/dialect-adapter.ts); [`mysql-adapter.ts` L14-L16](https://github.com/kysely-org/kysely/blob/a5bd19a8ebe2a6c22d4901b6cc7b9082b1419a76/src/dialect/mysql/mysql-adapter.ts#L14-L16); [`postgres-adapter.ts` L14-L16](https://github.com/kysely-org/kysely/blob/a5bd19a8ebe2a6c22d4901b6cc7b9082b1419a76/src/dialect/postgres/postgres-adapter.ts#L14-L16)) **(verified in source/docs)**. SQL text differences live in per-dialect `QueryCompiler` subclasses. Kysely is "what you write is what is sent": no emulation, no rewrite.

### 6. MySQL 1093

- Raw database error. In [#192](https://github.com/kysely-org/kysely/issues/192) a user hit `ER_UPDATE_TABLE_USED` (1093); the maintainer's answer was a hand-written derived-table wrapper (`selectFrom(eb => eb.selectFrom(...).as('O3'))`), not a library change, and he declined MySQL-only `SET` syntax because people would use it on other dialects **(verified in source/docs)**.

---

## TypeORM

### 1. Writes that return rows

- Query builders have `.returning()`. `DeleteQueryBuilder.returning()` throws `ReturningStatementNotSupportedError` when `driver.isReturningSqlSupported("delete")` is false ([`DeleteQueryBuilder.ts` L286-L294](https://github.com/typeorm/typeorm/blob/911177c2d68511e0a75ffe189644e7def0c8d830/packages/typeorm/src/query-builder/DeleteQueryBuilder.ts#L286-L294)): a run-time refusal at build time **(verified in source/docs)**.
- Support table: PostgreSQL true for all ([`PostgresDriver.ts` L1646-L1648](https://github.com/typeorm/typeorm/blob/911177c2d68511e0a75ffe189644e7def0c8d830/packages/typeorm/src/driver/postgres/PostgresDriver.ts#L1646-L1648)); MySQL false for all, MariaDB turned on per server version (delete from 10.0.5, insert from 10.5.0) ([`MysqlDriver.ts` L326-L332, L414-L428](https://github.com/typeorm/typeorm/blob/911177c2d68511e0a75ffe189644e7def0c8d830/packages/typeorm/src/driver/mysql/MysqlDriver.ts#L326-L428)); the SQLite base driver returns false ([`AbstractSqliteDriver.ts` L978-L980](https://github.com/typeorm/typeorm/blob/911177c2d68511e0a75ffe189644e7def0c8d830/packages/typeorm/src/driver/sqlite-abstract/AbstractSqliteDriver.ts#L978-L980)) **(verified in source/docs)**.
- `save()`/`update` by entity: for generated columns (version, update date), with `RETURNING` it reads them from the result; without it, it runs the `UPDATE` and then a `SELECT … WHERE <id>` ([`ReturningResultsEntityUpdator.update` L32-L130](https://github.com/typeorm/typeorm/blob/911177c2d68511e0a75ffe189644e7def0c8d830/packages/typeorm/src/query-builder/ReturningResultsEntityUpdator.ts#L32-L130), comment: "for driver which do not support returning/output statement we need to perform separate query") **(verified in source/docs)**. So TypeORM emulates write-then-SELECT, the opposite order to Prisma, and only for generated columns. `save()` loads the existing entity before deciding insert or update **(from memory, not verified)**.
- `UpdateResult.affected` / `DeleteResult.affected` come from `affectedRows` on MySQL **(verified in source/docs)**.

### 2. Emulation guarantees

- The post-update `SELECT` is by id, inside the `save()` transaction; no lock, no count check **(verified in source/docs for the code read)**.

### 3. First-row claim

- No high-level call. `setLock("pessimistic_write")` plus `setOnLocked("skip_locked" | "nowait")` on `SelectQueryBuilder` ([`SelectQueryBuilder.ts` L1547-L1592, L2812-L2816](https://github.com/typeorm/typeorm/blob/911177c2d68511e0a75ffe189644e7def0c8d830/packages/typeorm/src/query-builder/SelectQueryBuilder.ts#L1547-L2816)) **(verified in source/docs)**.

### 4. Affected-row checks

- `OptimisticLockVersionMismatchError` is thrown only by a **read**: `findOne` with `lock: { mode: "optimistic", version }` compares the loaded version with the expected one ([`SelectQueryBuilder.ts` L1712-L1729](https://github.com/typeorm/typeorm/blob/911177c2d68511e0a75ffe189644e7def0c8d830/packages/typeorm/src/query-builder/SelectQueryBuilder.ts#L1712-L1729)) **(verified in source/docs)**. `save()` updates by id without the version in the `WHERE` and does not check the affected count ([`SubjectExecutor.executeUpdateOperations` L519-L600](https://github.com/typeorm/typeorm/blob/911177c2d68511e0a75ffe189644e7def0c8d830/packages/typeorm/src/persistence/SubjectExecutor.ts#L519-L600)) **(verified in source/docs)**.

### 5. Capability handling

- Driver methods (`isReturningSqlSupported(type)`), some set from the server version at connect time **(verified in source/docs)**. No rewrite.

### 6. MySQL 1093

- No workaround found; no issue thread found by search **(not verified either way)**.

---

## Sequelize

### 1. Writes that return rows

- v6: `returning` is documented as "Postgres only" on `create`, `bulkCreate`, `update`, `upsert` ([`model.js` L2297, L2639, L3180](https://github.com/sequelize/sequelize/blob/516c6635a86152270471fbfad11d38cc91e9ee15/src/model.js#L3180)); only the PostgreSQL dialect declares `returnValues: { returning: true }` ([`dialects/postgres/index.js`](https://github.com/sequelize/sequelize/blob/516c6635a86152270471fbfad11d38cc91e9ee15/src/dialects/postgres/index.js)) **(verified in source/docs)**. On other dialects the option is ignored, not refused **(from memory, not verified)**.
- `Model.update` returns `[affectedCount]` or, with `returning` on PostgreSQL, `[affectedCount, rows]` ([`model.js` L3352-L3357](https://github.com/sequelize/sequelize/blob/516c6635a86152270471fbfad11d38cc91e9ee15/src/model.js#L3352-L3357)); `Model.destroy` returns the number of destroyed rows (doc at L3020) **(verified in source/docs)**.
- v7 (alpha, `main`): SQLite now also declares `returnValues: 'returning'` ([`packages/sqlite3/src/dialect.ts` L48](https://github.com/sequelize/sequelize/blob/6f4cca6a74639b5d057f3823359489b52902191e/packages/sqlite3/src/dialect.ts#L48)); MySQL and MariaDB do not **(verified in source/docs)**.

### 2. Emulation

- None for update/delete **(from memory, not verified)**.

### 3. First-row claim

- No high-level call. `findAll({ lock: transaction.LOCK.UPDATE, skipLocked: true })`; the v6 doc says `skipLocked` is "Only supported in Postgres" ([`model.js` L1728-L1729](https://github.com/sequelize/sequelize/blob/516c6635a86152270471fbfad11d38cc91e9ee15/src/model.js#L1728-L1729)) **(verified in source/docs)**. `Model.update` takes `limit` for MySQL and MariaDB (L3180 doc block) **(verified in source/docs)**.

### 4. Affected-row checks

- Instance `save()` with a `version` attribute: increments the version, puts it in the `WHERE`, and throws `OptimisticLockError` when `rowsUpdated < 1` ([`model.js` L4146-L4165](https://github.com/sequelize/sequelize/blob/516c6635a86152270471fbfad11d38cc91e9ee15/src/model.js#L4146-L4165)) **(verified in source/docs)**.
- Sequelize is the one library that turns off `FOUND_ROWS` on MySQL (`flags: '-FOUND_ROWS'` in v6 [`connection-manager.js` L58](https://github.com/sequelize/sequelize/blob/516c6635a86152270471fbfad11d38cc91e9ee15/src/dialects/mysql/connection-manager.js#L58), and v7 [`packages/mysql/src/connection-manager.ts` L121](https://github.com/sequelize/sequelize/blob/6f4cca6a74639b5d057f3823359489b52902191e/packages/mysql/src/connection-manager.ts#L121)), so its MySQL counts are changed rows **(verified in source/docs)**. The version bump guarantees a change, so the lock check still works.

### 5. Capability handling

- A per-dialect `supports` object (`returnValues`, `inserts.ignoreDuplicates`, …) read by the query generator **(verified in source/docs)**.

### 6. MySQL 1093

- No workaround found; no issue thread found by search **(not verified either way)**.

---

## MikroORM

### 1. Writes that return rows

- `Platform.usesReturningStatement()` is false by default and true for PostgreSQL and SQLite ([`Platform.ts` L98-L105](https://github.com/mikro-orm/mikro-orm/blob/d19dc8a66295ee68b749501bc2aa3ab315426f44/packages/core/src/platforms/Platform.ts#L98-L105); [`BasePostgreSqlPlatform.ts` L42](https://github.com/mikro-orm/mikro-orm/blob/d19dc8a66295ee68b749501bc2aa3ab315426f44/packages/sql/src/dialects/postgresql/BasePostgreSqlPlatform.ts#L42); [`SqlitePlatform.ts` L25](https://github.com/mikro-orm/mikro-orm/blob/d19dc8a66295ee68b749501bc2aa3ab315426f44/packages/sql/src/dialects/sqlite/SqlitePlatform.ts#L25)); MySQL and MariaDB keep false **(verified in source/docs)**.
- It is used to read back generated values on insert and update, not to return whole rows to the user. `QueryBuilder.returning()` exists, but `processReturningStatement` returns early (dropping the hint silently) when the platform has no `RETURNING`, and also when the query has no data, which covers deletes ([`QueryBuilder.ts` L2073-L2076, L2356-L2374](https://github.com/mikro-orm/mikro-orm/blob/d19dc8a66295ee68b749501bc2aa3ab315426f44/packages/sql/src/query/QueryBuilder.ts#L2356-L2374)) **(verified in source/docs; the delete case is inferred from source)**.
- `em.nativeUpdate`/`em.nativeDelete` run one statement and return `QueryResult` (`affectedRows`, `insertId`) ([`AbstractSqlDriver.nativeDelete` L1856-L1877](https://github.com/mikro-orm/mikro-orm/blob/d19dc8a66295ee68b749501bc2aa3ab315426f44/packages/sql/src/AbstractSqlDriver.ts#L1856-L1877)) **(verified in source/docs)**. Without `RETURNING`, the unit of work reloads versions and database defaults with a separate `SELECT` after the write (`reloadVersionValues`, [`ChangeSetPersister.ts` L592](https://github.com/mikro-orm/mikro-orm/blob/d19dc8a66295ee68b749501bc2aa3ab315426f44/packages/core/src/unit-of-work/ChangeSetPersister.ts#L592)) **(verified in source/docs)**.

### 2. Emulation

- Write then `SELECT` for generated values only, inside the flush transaction **(verified in source/docs)**. No locks.

### 3. First-row claim

- No high-level call. `LockMode.PESSIMISTIC_PARTIAL_WRITE` renders `FOR UPDATE SKIP LOCKED`, `PESSIMISTIC_WRITE_OR_FAIL` renders `FOR UPDATE NOWAIT` ([`enums.ts` L241-L253](https://github.com/mikro-orm/mikro-orm/blob/d19dc8a66295ee68b749501bc2aa3ab315426f44/packages/core/src/enums.ts#L241-L253)); `setLockMode` refuses pessimistic modes outside a transaction ([`QueryBuilder.ts` L2135-L2146](https://github.com/mikro-orm/mikro-orm/blob/d19dc8a66295ee68b749501bc2aa3ab315426f44/packages/sql/src/query/QueryBuilder.ts#L2135-L2146)) **(verified in source/docs)**.

### 4. Affected-row checks

- Yes, the clearest example. For an entity with a version property or concurrency-check keys, a single update throws `OptimisticLockError.lockFailed` when `affectedRows` is 0 (`checkOptimisticLock`, [L578-L586](https://github.com/mikro-orm/mikro-orm/blob/d19dc8a66295ee68b749501bc2aa3ab315426f44/packages/core/src/unit-of-work/ChangeSetPersister.ts#L578-L586)); a batch update throws when `affectedRows < changeSets.length`, and first does a `SELECT` of `(pk, version)` pairs and throws if fewer come back (L354-L398, L522-L575) **(verified in source/docs)**. Deletes in the unit of work are `DELETE … WHERE pk IN (…)` with no count check (L113-L133) **(verified in source/docs)**. MikroORM uses `mysql2` and I found no flag override, so MySQL counts are matched rows **(inferred from source)**; the version bump makes the distinction moot for the lock check.

### 5. Capability handling

- Platform methods (`usesReturningStatement`, `usesOutputStatement`, …) consulted by the driver and query builder **(verified in source/docs)**. The unit of work batches many change sets into fewer statements, which is the nearest thing to "combine statements" among these libraries, but it is batching of independent writes, not rewriting one operation's plan **(inferred from source)**.

### 6. MySQL 1093

- Partly worked around. When an update or delete needs joins, the query builder rewrites it to `WHERE pk IN (SELECT pk FROM (<select with joins>) AS alias)`, with a comment linking the 1093 Stack Overflow question ([`wrapModifySubQuery`, `QueryBuilder.ts` L4603-L4624](https://github.com/mikro-orm/mikro-orm/blob/d19dc8a66295ee68b749501bc2aa3ab315426f44/packages/sql/src/query/QueryBuilder.ts#L4603-L4624)) **(verified in source/docs)**. Correlated subqueries from collection operators (`$none` etc.) are not wrapped: a test asserts that `nativeUpdate` with `$none` on MySQL rejects with "You can't specify target table" ([`collection-operators.test.ts` L376-L389](https://github.com/mikro-orm/mikro-orm/blob/d19dc8a66295ee68b749501bc2aa3ab315426f44/tests/features/collection/collection-operators.test.ts#L376-L389)) **(verified in source/docs)**.

---

## Summary table

| Question | Prisma 5–7 | Drizzle | Kysely | TypeORM | Sequelize | MikroORM |
| --- | --- | --- | --- | --- | --- | --- |
| 1. Returning writes; MySQL | Single-record `create/update/delete` always return the record. PG/SQLite: `… RETURNING` when no nested selection. MySQL: emulated. `…ManyAndReturn` absent from the MySQL client (type level). | `.returning()` on PG/SQLite. Absent on MySQL builders (type level). `$returningId()` computes ids from `insertId`/`affectedRows`, no extra query. | `returning` on all dialects; on MySQL it is sent and the database rejects it (run time). Results `numDeletedRows`, `numUpdatedRows`, `numChangedRows`, `insertId`. | `.returning()` throws `ReturningStatementNotSupportedError` on MySQL (run time, at build). MariaDB enabled by version. `save()` reloads generated columns with a `SELECT` after the write. | `returning` PG only (v6); v7 adds SQLite. `update` → `[count]`, `destroy` → count. | `RETURNING` used internally on PG/SQLite for generated values; user `returning()` hint silently dropped on MySQL. `nativeUpdate/Delete` → `affectedRows`. |
| 2. SELECT-then-write guarantees | Transaction yes; row locks no; filter re-checked in the write (`id IN (…) AND filter`); affected count ignored; race accepted (can return a row it did not update or delete, issue #19233). | No emulation. | No emulation. | Write then `SELECT` by id, in the save transaction; no lock, no count check. | No emulation. | Write then `SELECT` for versions/defaults, in the flush transaction; no lock. |
| 3. First-row claim | No call (#4349, #14445 open). Docs: OCC with `updateMany` on `{ id, version }` and check `count`. No locking reads (#8580 open). | No call. MySQL/SQLite update/delete have `orderBy` + `limit`; `.for('update', { skipLocked })`. | No call. `forUpdate().skipLocked()`; `orderBy`/`limit` on update/delete. | No call. `setLock('pessimistic_write')` + `setOnLocked('skip_locked')`. | No call. `lock` + `skipLocked` (PG only in v6). | No call. `LockMode.PESSIMISTIC_PARTIAL_WRITE` = `FOR UPDATE SKIP LOCKED`, requires a transaction. |
| 4. Affected-row checks | None. `P2025` comes from the pre-read or empty `RETURNING`, never from a count. | None. | None. | None on write; `OptimisticLockVersionMismatchError` is a read-time version compare. | `OptimisticLockError` when versioned `save()` updates 0 rows. Turns `FOUND_ROWS` off (changed rows). | `OptimisticLockError` when versioned update `affectedRows` is 0 or below the batch size; pre-batch version `SELECT`. |
| 5. Capability handling | Connector capability flags checked while building the query graph; final shape chosen up front, no later rewrite. | Separate builder classes per dialect. | One builder; `DialectAdapter` flags (`supportsReturning`) only change the result shape; per-dialect compilers. | Driver methods, some set from server version. | Dialect `supports` object. | Platform methods. |
| 6. MySQL 1093 | Worked around: MySQL visitor wraps any sub-select on the target table in a derived table (also makes `limit` legal). | Raw error. | Raw error; maintainer suggests a hand-written derived table (#192). | Not found. | Not found. | Worked around for joined updates/deletes (derived table); raw error for correlated subqueries (tested). |
