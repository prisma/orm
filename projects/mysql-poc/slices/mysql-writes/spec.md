# Slice 4 — MySQL ORM writes

**Linear:** [TML-3696](https://linear.app/prisma-company/issue/TML-3696) · **Project:** [`../../spec.md`](../../spec.md) · **Status:** decided 2026-10-30

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

## Chosen design (pending the decisions)

- **The ORM picks a strategy per write from the `returning` capability**, as ADR 164 says. Postgres and SQLite keep their current single statement. Without `returning`:
  - **`create`/`createAll`:** insert, then select by identity.
    - The identity is the client's key values when the caller or a client-side default supplies them.
    - Otherwise it is the insert id the driver reports (decision 1).
  - **`update`:** unchanged up to the update, which then runs without `RETURNING`. A `Find` by identity reads the row back, using the new key values if the update sets a key column.
  - **`updateAll`:** select identities with the filter, update by identity, then select by identity.
  - **`delete`/`deleteAll`:** select the rows first, then delete by identity. This is the graph the include path already builds.
  - **Nested creates:** insert without `RETURNING`, then take the parent key from the client values or the insert id.
- **The MySQL renderer renders insert, update, delete, and upsert as `INSERT … AS new ON DUPLICATE KEY UPDATE`**, writing `excluded.c` as `new.c`.
- **Upsert on MySQL** is allowed only as decision 2 says, and its row is read back by the conflict values (the update's value for a conflict column the update sets, when `affectedRows` is 2).
- **Tests:**
  - Every fallback also runs on SQLite with `returning` turned off in a test contract.
  - Live MySQL tests cover each method.
  - The example app writes.

## Decisions (2026-10-30)

1. **The driver's write result is extended (Will).** `SqlStatementStats` in the SQL family gains an optional `lastInsertId`, the id the database generated for the statement's first inserted row. The MySQL driver fills it from the `mariadb` package's `insertId`; drivers whose database reports none leave it out. The SQL runtime already returns the driver's result object unchanged (`sql-runtime.ts:416`, `:1048`); only the type changes. The framework's `RuntimeStatementStats` does not change.
2. **A new capability says whether a conflict clause applies only to the named columns (Will).** `sql.insertOnConflictTarget`: "an insert's conflict clause applies only to the unique columns it names". The Postgres and SQLite adapters report it; MySQL does not. Upsert, and `onConflict: 'skip'` with `conflictOn`, require it. Without it, the ORM allows upsert only when the contract shows the named columns are the only unique key the create values can collide on: every other primary key or unique constraint contains an auto-increment column the create values leave out. Otherwise it refuses with `ORM.CAPABILITY_MISSING`. The project's example passes: auto-increment `id`, unique `email`.
3. **A row-returning `createAll` whose rows get generated ids is refused on MySQL.** MySQL reports only the first id of a multi-row insert, and the rest are consecutive only while no bulk insert runs on the table at the same time. `createAndCount` and single-row `create` work.
4. **The `updateAll` read-then-write takes no row lock**, as Postgres's `update()` selects then updates without one. The non-goal "no row locking on MySQL" stands; the project spec's decision 5 is reworded to match.
5. **`onConflict: 'skip'` stays refused on MySQL.** `INSERT IGNORE` hides foreign-key and `NOT NULL` errors, and the no-op `ON DUPLICATE KEY UPDATE` miscounts. Recorded in `deferred.md`.

## Out of scope

- MariaDB, and splitting `returning` per statement kind (MariaDB has `RETURNING` on insert and delete only). Both are slice 6.
- Variants with their own tables.
- Row locking.
