# @internal/target-mysql

MySQL target pack for Prisma 8.

## Package Classification

- **Domain**: targets
- **Layer**: targets
- **Plane**: multi-plane (shared, migration, runtime)

## Purpose

Declares what MySQL is to the SQL family: its data types, codecs and PSL scalars, its single namespace, the control tables, and the control target descriptor that projects a contract onto the schema IR introspection compares it with.

## Responsibilities

- **Descriptor metadata**: `targetId: 'mysql'`, `supportsNamespaces: false` and the unbound default namespace ([ADR 223](../../../../docs/architecture%20docs/adrs/ADR%20223%20-%20Target-owned%20default%20namespace.md)). Namespace blocks are refused through that flag, with the display name and reason the descriptor supplies.
- **Data types** (`src/core/data-types.ts`, [ADR 254](../../../../docs/architecture%20docs/adrs/ADR%20254%20-%20Data%20types%20and%20casts.md)): `mysql/int`, `mysql/bigint`, `mysql/varchar`, `mysql/char`, `mysql/text`, `mysql/datetime` and `mysql/enum`. PSL `String` is `varchar(191)`, so a `@unique` column can be indexed. `mysql/enum` is a native `enum('A','B')` column type whose name is the text MySQL's catalog prints, so `db verify` compares the members and their order.
- **Enum columns** (`src/core/mysql-database.ts`): the namespace factory writes each enum column's members, from the value set the column names, into its type parameters in declared order. No CHECK constraint is derived.
- **Codecs**: one per data type, plus MySQL adaptations of the family's `sql/char@1`, `sql/varchar@1` and `sql/raw@1`. Each `fromWire` reads what the driver hands over: the text MySQL sends, for every column; an include's JSON carries an `int` as a number. `projectJson` writes a column into the JSON an include reads, in the form its `fromWire` reads from a row: `int`, the text types, `enum` and `datetime` pass through; `bigint` renders as `CAST(x AS CHAR)`, because JavaScript's `JSON.parse` would round a number past 2^53. A raw column is refused. As on Postgres, `toWire` returns what the database reads for each data type: the `int` codec a number and the `bigint` codec decimal text, as the Postgres `int8` codec does. MySQL reads a text parameter beside a `bigint` column exactly; where nothing gives a parameter a type, as in `?1 + ?2` in raw SQL, the author writes the cast, as on Postgres. The bigint codec refuses a value outside the signed 64-bit range.
- **Control tables**: `_prisma_marker` and `_prisma_ledger` live beside the application's tables, because MySQL has no schema inside a database. `src/contract-free/control-bootstrap.ts` declares their DDL.
- **Control target descriptor**: contract serializer, `contractToSchema`, `diffSchema`, the planner and the runner.
- **Planner** (`src/core/migrations/planner.ts`, `issue-planner.ts`): creates and drops tables, columns, indexes, unique constraints and foreign keys, with backtick-quoted DDL. Foreign keys are added after every table exists and dropped first. Dropping a foreign key also drops the index InnoDB made for it, when no other index served the key and the destination keeps no index of that name; dropping an index a foreign key of the destination uses, with no other index to take over, is refused, because MySQL refuses it. A change to a column's type, nullability or default, a primary key, a CHECK constraint, a required column with no default, a name longer than 64 characters, an autoincrement column that does not lead the primary key or a unique constraint, and every statement such as a rename are refused with a conflict that says they are not yet supported on MySQL. `migration.ts` is written as calls on `MysqlMigration` (`src/core/migrations/mysql-migration.ts`).
- **Runner** (`src/core/migrations/runner.ts`): MySQL commits each DDL statement as it runs, so the runner applies one space at a time, each operation with its pre- and postchecks, then verifies the space's schema, with the strictness the caller passes, and writes its marker and ledger entries in one transaction. Every space is verified, not only the app space, because the marker write is where a space counts as applied. The whole apply holds the marker lock (`src/core/marker-lock.ts`), a `GET_LOCK` named after the database, released on the same connection when the apply ends.

## Exports

- `./pack`: the pack ref for `defineContract` and the PSL interpreter
- `./runtime`: the runtime target descriptor and `MysqlContractSerializer`
- `./control`: the control target descriptor and `mysqlCreateNamespace`
- `./migration`: `MysqlMigration` as `Migration`, the migration calls, the planner and the runner
- `./codecs`, `./codec-ids`, `./codec-types`, `./codec-descriptor`: codecs and their registry
- `./data-types`: data types and their PSL authoring entries
- `./contract-free`, `./ddl`, `./control-tables`: control-table DDL and the control table names
- `./marker-lock`: the marker lock, `withMarkerLock`, which the runner and the control adapter take and release
- `./default-normalizer`, `./sql-utils`, `./errors`: helpers the adapter shares
