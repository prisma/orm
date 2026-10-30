# Slice 4 — MySQL ORM writes

**Linear:** [TML-3696](https://linear.app/prisma-company/issue/TML-3696) · **Project:** [`../../spec.md`](../../spec.md) · **Status:** decided 2026-10-30, after the design reviews in `reviews/`

## At a glance

```ts
const user = await db.orm.User.create({ email: 'a@example.com', role: 'USER' })
await db.orm.User.where({ id: user.id }).update({ role: 'ADMIN' })
await db.orm.User.upsert({
  create: { email: 'a@example.com', role: 'USER' },
  update: { role: 'ADMIN' },
  conflictOn: { email: 'a@example.com' },
})
await db.orm.User.where({ id: user.id }).delete()
const n = await db.orm.User.where({ role: 'USER' }).updateAndCount({ role: 'ADMIN' })
```

Each call returns what it returns on Postgres. The example app runs them against MySQL 8.4 in CI.

## What the system does today

All of this was read in the code or probed against MySQL 9.6 (`wip/slice4-mine/p.mjs`).

- **The ORM checks capabilities before every write.**
  - `create`, `createAll`, `upsert`, `update`, `updateAll`, `delete` and `deleteAll` call `assertReturningCapability` (`sql-orm-client/src/collection-contract.ts:928`). It refuses with `ORM.CAPABILITY_MISSING` when the contract does not report `returning`.
  - `createAndCount`, `updateAndCount` and `deleteAndCount` do not need `returning`.
  - On MySQL, which reports no `returning`, the row-returning writes are refused today. The count variants fail only because the MySQL renderer refuses insert, update and delete.
- **Writes run as a graph of statements** (`sql-orm-client/src/mutation-graph/`):
  - Each write is a graph of `Find`, `Insert`, `Update` and `Delete` nodes. Rows pass between nodes by identity columns.
  - `update()` already selects the row's identity, updates by it, and returns the updated row through `RETURNING` (`collection-graphs.ts:75`).
  - `delete()` and `deleteAll()` with includes already select the rows before deleting them.
  - Nested creates insert with `RETURNING` and pass the parent's key to the children (`mutation-executor.ts:1182`).
- **ADR 164 already allows the fallback.** It makes the ORM client a repository layer that may run several single-statement Plans per call. It names "INSERT followed by SELECT using known key" for a target without `RETURNING`. It also says the strategy is chosen from contract capabilities. The ORM has not built that strategy; it refuses instead.
- **The driver reports only `affectedRows`** (`relational-core/src/ast/driver-types.ts:24`). MySQL's insert id reaches the `mariadb` package (`insertId`) and stops at the driver.
- **Upsert names its conflict columns** (`InsertOnConflict.on(columns)`, `query-plan-mutations.ts:301`).
  - MySQL's `INSERT … AS new ON DUPLICATE KEY UPDATE` fires on any unique key.
  - Probe: on a table with unique `email` and unique `handle`, an upsert keyed on email `'zzz'` collided on `handle`. It updated another user's row.
  - No capability says whether a database honours named conflict columns, because Postgres and SQLite both do.
- **Counts:** the MySQL driver sets `foundRows`, so `UPDATE` reports matched rows, as Postgres does. An upsert reports 1 for an insert and 1 for a match that changed nothing, and 2 for a change.

## Where the shared code cannot serve MySQL

1. **No generated id leaves the driver.** `create` on a table with an auto-increment key cannot find the row it inserted, and nested creates cannot pass a generated parent key to their children. This is in the SQL family's driver interface.
2. **No capability distinguishes "honours the named conflict columns" from "conflicts on any unique key".** Upsert and `onConflict: 'skip'` with `conflictOn` assume the former. This is in the capability model and the ORM's checks.
3. **The ORM refuses where ADR 164 says it should read back.** This is ORM client work, in the extensions domain, not the framework or the SQL family.

Everything else is MySQL target work: render insert, update, delete and upsert.

Both gaps are fixed in this slice with Will's approval (decisions 1 and 2).

## Chosen design

- **The ORM picks a strategy per write from the `returning` capability**, as ADR 164 says, decided from the contract before anything runs. Postgres and SQLite keep their current single statement. Without `returning`:
  - **`create`/`createAll`:** insert, then select by identity.
    - The identity is the client's key values when the caller or a client-side default supplies them.
    - Otherwise it is the insert id the driver reports (decision 1), read only after a plain one-row insert whose `affectedRows` is 1.
    - `create` is refused before running when a key column the client does not supply has a database default other than auto-increment (for example `UUID()`): MySQL reports 0 for it, so the row cannot be found.
  - **`update`:** unchanged up to the update, which then runs without `RETURNING`. A `Find` by identity reads the row back, using the new key values if the update sets a key column.
  - **`updateAll`/`deleteAll`:** select identities with the filter, then write with the caller's filter (`UPDATE … WHERE <filter>`, `DELETE … WHERE <filter>`), as Postgres does and as `updateAndCount`/`deleteAndCount` already send. The pre-selected identities are used only for the read-back (`updateAll`) or the returned snapshot (`deleteAll`), written as an `IN` list for a single-column identity. Under concurrency only the returned list can differ from Postgres.
  - **Nested creates:** insert without `RETURNING`, then take the parent key from the client values or the insert id.
- **The MySQL renderer renders insert, update, delete, and upsert as `INSERT … AS new ON DUPLICATE KEY UPDATE`**, writing `excluded.c` as `new.c`. It refuses an upsert whose AST names conflict columns; after its check, the ORM sends none.
- **Upsert on MySQL** is allowed only as decision 2 says. Its row is read back by the create's conflict values, with no reading of `affectedRows`. An upsert whose update sets a conflict column is refused without `returning`. When the read-back finds no row, the ORM fails inside the transaction and rolls back, which covers a unique index the contract does not list.
- **A missing `insertId`** where the ORM needs it fails inside the transaction with its own error code, whose message says a middleware may have supplied the result. `insertSingleRow` (nested creates) checks the same way.
- **Tests:**
  - Every fallback also runs on SQLite with `returning` off, using a contract emitted against an adapter that does not report it (never a patched contract).
  - Live MySQL tests cover each method, including concurrent writers.
  - A middleware that intercepts an insert's `execute` and returns `{ affectedRows: 1 }` makes `create` fail and leaves no row.
  - The example app writes.

## Decisions (2026-10-30)

1. **A write reports the id the database generated for a one-row insert (Will, 2026-10-30).** `SqlStatementStats` in the SQL family gains an optional `insertId`: the value the database numbered automatically, as decimal text, set only when the statement changed exactly one row and the database reported a value. It names the inserted row only after a one-row insert, so the ORM reads it only after one. The MySQL driver fills it from the `mariadb` package's `insertId` when it is above 0; the SQLite driver fills it from `lastInsertRowid` when `changes` is 1 (after a one-row `UPDATE` that value is stale, which is why the reader checks); Postgres leaves it out, because it has `RETURNING`. The ORM's insert node reads it only when it needs a key the caller did not supply, decodes it through the key column's codec, and fails inside the transaction, rolling the insert back, when it is absent. The framework does not change. Reviews (`reviews/write-result-architect.md`, `reviews/write-result-principal.md`) rejected the alternatives:
   - **Generated keys as rows, or a family write result with a `generatedKeys` member:** a database without `RETURNING` reports at most one integer per statement, over the wire or over HTTP, so neither shape can be filled; the general concept, the rows a write returns, is already `RETURNING`.
   - **A framework result type each family binds:** the value must be optional, so a middleware dropping it still type-checks, and ADR 271 rejected a generic parameter for client result types because middleware written once for every client could not name it.
   - **A follow-up `SELECT LAST_INSERT_ID()`:** an extra round trip, and it names a MySQL function in shared code.
2. **A new capability says whether a conflict clause applies only to the named columns (Will).** `sql.insertOnConflictTarget`: "an insert's conflict clause applies only to the unique columns it names". The Postgres and SQLite adapters report it; MySQL does not. Upsert, and `onConflict: 'skip'` with `conflictOn`, require it. Without it, the ORM allows upsert only when the contract shows the named columns are the only unique key the create values can collide on: every other primary key or unique constraint contains an auto-increment column the create values leave out. Otherwise it refuses with `ORM.CAPABILITY_MISSING`. The project's example passes: auto-increment `id`, unique `email`.
3. **A row-returning `createAll` whose rows get generated ids is refused on MySQL.** MySQL reports only the first id of a multi-row insert, and the rest are consecutive only while no bulk insert runs on the table at the same time. `createAndCount` and single-row `create` work.
4. **The `updateAll` read-then-write takes no row lock**, as Postgres's `update()` selects then updates without one. The write keeps the caller's filter, so it never changes a row that stopped matching; writing by the selected ids alone overwrote a concurrent change in a probe, and an `OR` of 60,000 ids locked the whole table for 84 seconds (`reviews/design-review-principal.md`). The non-goal "no row locking on MySQL" stands; the project spec's decision 5 is reworded to match.
5. **`onConflict: 'skip'` stays refused on MySQL.** `INSERT IGNORE` hides foreign-key and `NOT NULL` errors, and the no-op `ON DUPLICATE KEY UPDATE` miscounts. Recorded in `deferred.md`.

6. **MySQL transactions run at READ COMMITTED (Will, 2026-10-30).** The MySQL target sets `transaction_isolation = 'READ-COMMITTED'` as a session setting, as it sets the time zone, so a read-back inside the ORM's transaction sees rows other sessions committed, as on Postgres. Under MySQL's default REPEATABLE READ, an update that changed nothing read back the old value, and an upsert with `update: {}` in a user transaction found no row. Transaction isolation controls are on the roadmap and will replace this.

## Out of scope

- MariaDB, and splitting `returning` per statement kind (MariaDB has `RETURNING` on insert and delete only). Both are slice 6.
- Variants with their own tables.
- Row locking.
