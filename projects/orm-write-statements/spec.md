# How the ORM client builds writes, and what they return on each database

Linear: [TML-3941](https://linear.app/prisma-company/issue/TML-3941). Design settled 2026-11-24 to 2026-11-27. Nothing is built yet.

## At a glance

Three changes to the ORM client (`packages/3-extensions/sql-orm-client`):

```ts
// 1. One call, one decision. On Postgres this is built as a single
//    DELETE … RETURNING. Today it is built as a SELECT plus a DELETE,
//    and a rewrite rule merges them afterwards.
const deleted = await db.orm.Post.where({ authorId }).deleteAll();

// 2. On MySQL, which has no RETURNING, the same methods exist and each
//    is one statement. They return what MySQL reports.
const count = await db.orm.Post.where({ authorId }).deleteAll(); // number
const key = await db.orm.Post.create({ title: 'Hello' });        // { id: 42 }

// 3. On every database, update() and delete() act on one record named
//    by a unique key. "One of the matching rows" is written with a limit.
await db.orm.Job.whereUnique({ id }).update({ state: 'running' });
await db.orm.Job.where({ state: 'queued' }).limit(1).updateAll({ state: 'running' });
await db.orm.Job.where({ state: 'queued' }).update({ state: 'running' }); // compile error
```

## Terms

- **ORM client**: the layer where one method call may run several statements. `db.orm.Post` is a **collection**; `create`, `updateAll`, `delete` and so on are its methods.
- **Statement graph**: the ordered statements the ORM client runs for one collection method call. The code is in `src/statement-graph/`. Its nodes are statements (`Find`, `Insert`, `Update`, `Delete`, …) and its edges carry rows and keys from one statement to the next.
- **`returning` capability**: a flag in the contract, reported by the database adapter, that says the database supports a `RETURNING` clause on `INSERT`, `UPDATE` and `DELETE`. Postgres and SQLite have it. MySQL does not, and the MariaDB adapter reports it off.

## Background

### How a write that returns rows is built today

For a call such as `deleteAll()`, the ORM client builds the form a database without `RETURNING` would need: a `Find` that reads the rows, then the `Delete`. Three rewrite rules (`fold-rule.ts`, `delete-rule.ts`, `read-back-rule.ts`, registered in `rules.ts`) run as nodes are added. They are registered only when the contract has `returning`. A rule recognises the read and the write as a pair and merges them into one statement with a `RETURNING` clause.

A rule recognises the pair by comparing the two nodes' filter conditions as JavaScript objects (`find.ast.where === where` in `rule-patterns.ts`).

### What went wrong

In `8.0.0-rc.24` the code that builds the filter condition returned a new object on each call whenever the collection had two or more filters. The read and the write were given different objects, so the rule did not fire. Nothing failed. The call ran as two statements, and `deleteAll()` and `delete()` returned the rows the `SELECT` had read, not the rows the `DELETE` removed. `updateAll()` returned the right rows and cost an extra statement.

[prisma/orm#31188](https://github.com/prisma/orm/pull/31188) fixed that case by building the condition once. The design is unchanged: whether a call is one statement still depends on a rule recognising two nodes that were created separately, and a miss is silent.

### Where MySQL stands today

MySQL has no `RETURNING`, so every write that returns rows runs as several statements in a transaction the ORM client opens. A bulk write passes the keys of every affected row from one statement to the next, so the list is as long as the result. Two more limits apply:

- MySQL refuses a write whose subquery reads the table being written (error 1093), and the MySQL renderer refuses such a statement on purpose.
- Row locks (`forUpdate()`) are not built for MySQL.

So "update the first matching row and return it" cannot be made safe against two workers on MySQL today.

## What this project is for

1. A write runs the statements its author intended, or it fails. It never quietly runs a different set of statements.
2. Each database gets an interface that is natural for it. A developer who knows the ORM client on one database finds it familiar on another. Code that runs unchanged on every database is not a goal: a method may differ between databases in what it does, whether it exists, its parameters and what it returns.
3. A call that reads as one statement is one statement wherever the database allows it.

## Design

### 1. The statement graph is built in its final form

For each collection method call, the ORM client reads the `returning` capability from the contract while it builds the statement graph, and builds the statements that will run. Nothing rewrites a graph after it is built.

- The three merge rules, their registration and the pattern helpers they use are deleted.
- The choice between forms is made in one place per kind of write (insert rows, update rows, delete rows). A top-level call and a nested write both go through it. It takes what the caller asked for, rows or a count.
- The SQL query builder and the raw SQL query builder are not touched. One query builder call is still one statement.

This reverses a recorded decision in [`projects/nested-mutations/mutation-graph.md`](../nested-mutations/mutation-graph.md) (its entry D18, which said the capability is not read while the graph is built). That record is already corrected. It agrees with [ADR 164](../../docs/architecture%20docs/adrs/ADR%20164%20-%20Repository%20Layer.md), which says the ORM client chooses between single-statement and multi-statement strategies from contract capabilities.

Every library surveyed chooses the final SQL from per-database flags when it builds the statement. None builds a general form and merges it afterwards. See [`research/prior-art/`](research/prior-art/).

### 2. What each write returns

On a database with `returning` (Postgres, SQLite), returns stay as they are today, apart from section 3.

On a database without it (MySQL, and MariaDB as its adapter describes it today), each write is one statement and returns what the database reports:

| Method | Statement on MySQL | Returns on MySQL | Returns with `returning` |
| --- | --- | --- | --- |
| `create()` | `INSERT … VALUES (…)` | The new record's key | The record |
| `createAll()` | `INSERT … VALUES (…), (…)` | A count | The records |
| `update()` | `UPDATE … WHERE key = ?` | A count, 0 or 1 | The record, or `null` |
| `updateAll()` | `UPDATE … WHERE …` | A count | The records |
| `delete()` | `DELETE … WHERE key = ?` | A count, 0 or 1 | The record, or `null` |
| `deleteAll()` | `DELETE … WHERE …` | A count | The records |
| `upsert()` | `INSERT … ON DUPLICATE KEY UPDATE …` | See "Work to settle first" | The record |

Consequences on MySQL:

- No write reads rows before or after it, so no call carries a key list as long as its result, and the ORM client opens no transaction for a plain write.
- To see a record after writing it, the application reads it by key, which is what a MySQL developer does today.
- `createAndCount()`, `updateAndCount()` and `deleteAndCount()` stay, and return the same count as the plain methods.

Why these returns: [`research/mysql-write-primitives.md`](research/mysql-write-primitives.md) records what MySQL reports after each statement, checked against the MySQL 8.4 manual. Most libraries do not return rows from a bulk write on MySQL.

### 3. `update()` and `delete()` act on one record named by a unique key

Today `where(filter).update(data)` changes one row, the one `first()` would return, and an order or an offset on the collection chooses it. That reads as "update every match", needs a subquery or a read before the write, and lets two workers pick the same row.

On every database:

- `update()` and `delete()` are accepted only on a collection filtered by a unique key (`whereUnique(...)`). On any other collection they are a compile error. Each is one statement: `UPDATE … WHERE key = ?` or `DELETE … WHERE key = ?`.
- `updateAll()`, `deleteAll()`, `updateAndCount()` and `deleteAndCount()` accept `orderBy(...)` and `limit(n)`. Today they throw `ORM.ARGUMENT_INVALID` on a collection with a limit. On MySQL this is the native `UPDATE … ORDER BY … LIMIT n`. On Postgres and SQLite it is one statement whose `WHERE` picks keys with a subquery, so it needs a primary key or a unique key whose columns are all `NOT NULL`.

This breaks applications written against any version published so far that call `update()` or `delete()` after a plain `where()`. They get a compile error and choose `whereUnique(...)` or `limit(1).updateAll(...)`. It needs an entry in the upgrade guide, and the repository's own examples, tests and docs need the same change.

A limited bulk write does not stop two workers choosing the same rows. That is the application's to handle, as it is in SQL. Claiming a job safely stays an explicit read with `forUpdate({ skipLocked: true })` inside a transaction.

### 4. How the types say it

The return types in section 2 depend on the contract's capabilities, so `db.orm.Post.deleteAll()` has type `Promise<number>` for a MySQL contract and a row collection for a Postgres contract.

Where a method or a combination is refused, the compiler error should state the reason. A spike compared seven ways to refuse a method in the types: [`research/refusing-a-method-in-the-types.md`](research/refusing-a-method-in-the-types.md). The one to use is a `this:` marker named for the requirement, which is how the collection already refuses `updateAll()` after `whereUnique(...)`. It is the only one whose error text gives the reason while helpers written over any contract still work. Removing a method's name from the class does not work, because users extend `Collection`.

## Work to settle first

Each of these needs a short investigation before the part of the work that depends on it. A recommendation is given where there is one.

1. **Can the types express a return type that depends on a capability,** together with the existing type states (`HasWhere`, `HasUniqueFilter`) and user subclasses of `Collection`? Spike it with real compiler output before building section 2. If it cannot be done cleanly, come back with what the compiler allows.
2. **What `create()` returns on MySQL when the key is neither supplied by the caller nor an `AUTO_INCREMENT` column,** for example a column default that the database computes. MySQL reports no value for it. Recommendation: return the key when it is known from the payload or the insert id, and find out what key defaults the MySQL target supports before deciding the remaining case.
3. **What `upsert()` returns on MySQL.** MySQL reports 1 for an insert and 2 for an update, which the caller can only read by convention. Whether the insert id is the row's key after an update needs a test against a server; the manual does not settle it. Recommendation: return whether the record was created or updated, with the key if the test shows it is reliable.
4. **`select(...)` and `include(...)` before a write on a database without `returning`.** The write returns a key or a count, so there are no rows to project or to attach relations to. Recommendation: a compile error that says so.
5. **`delete()` and `deleteAll()` with `include(...)` on a database with `returning`.** The related rows must be read before the parent is deleted. This is the one case where a write that returns rows legitimately needs a read first. Confirm what the code does today and keep it explicit in the place that builds deletes.
6. **Nested writes on MySQL.** A nested create needs the parent's key, which the insert id or the payload gives. A nested write under `update()` knows the parent's key only when the unique filter is the primary key. Some nested writes use today's "first matching row" form. List every nested write, and say for each what it runs on MySQL.
7. **Variants stored in their own table.** A write through a polymorphic base model touches two tables. Say what it runs and returns on MySQL.
8. **What happens to two planned slices of the nested-mutations project.** `read-back-reuse` adds a fourth merge rule; recommendation: drop it. `matched-rows` deals with rows that stop matching the filter between the write and the read back; with sections 1 to 3 most of it disappears. Update [`projects/nested-mutations/plan.md`](../nested-mutations/plan.md) to say so.

## Out of scope

- **Working around MySQL error 1093** by wrapping the subquery in a derived table. Hibernate, Rails, Django and Prisma 7 do it. With the returns above the ORM client's plain writes no longer need it. It can be added later.
- **Row locks on MySQL.**
- **Returning rows from `create()` and `delete()` on MariaDB.** MariaDB has `INSERT … RETURNING` and `DELETE … RETURNING`, and `UPDATE … RETURNING` from 13.0. Using them needs the `returning` capability split by statement kind.
- **Whether other calls on a transaction wait while a multi-statement ORM write runs** ([TML-3953](https://linear.app/prisma-company/issue/TML-3953)).
- **The framework domain** (`packages/1-framework`). A capability is an open string key, so none of this needs a change there. If the work seems to need one, stop and raise it.

## Constraints

- The ORM client does not branch on the target. It reads capabilities from the contract ([`.agents/rules/no-target-branches.mdc`](../../.agents/rules/no-target-branches.mdc)).
- A new capability key changes emitted contracts, so fixtures regenerate.
- These are public API changes. Each pull request names them, and the upgrade guide and release notes cover the `update()`/`delete()` change.

## Done when

- `rules.ts`, the three rule files and the pattern helpers are gone, and no code compares conditions by object identity to decide what runs.
- For every write method, a test asserts the exact statements run on a contract with `returning` and on one without it.
- On MySQL, each plain write in the table runs one statement, in no transaction opened by the ORM client, and returns what the table says. A type test covers each return type.
- `update()` and `delete()` after a plain `where()` are compile errors on every database, with an error that names the alternative. Bulk writes accept `orderBy` and `limit`.
- The eight items under "Work to settle first" each have an answer recorded in this folder.
- The package README, the collection's doc comments, the upgrade guide, ADR 164 and a decision record for the statement graph describe the result. The nested-mutations design record and plan agree with it.

## Suggested order

1. Remove the merge rules and build each write in its final form, with no change to what users see. This is the fix for the class of defect and stands alone.
2. `update()` and `delete()` require a unique key; bulk writes accept `orderBy` and `limit`.
3. The type spike, then the MySQL returns for plain writes.
4. `upsert()`, nested writes and variants on MySQL.

## References

- [`research/mysql-write-primitives.md`](research/mysql-write-primitives.md): what MySQL reports after each write.
- [`research/prior-art/classic-orms.md`](research/prior-art/classic-orms.md) and [`research/prior-art/typescript-libraries.md`](research/prior-art/typescript-libraries.md): how Active Record, Django, SQLAlchemy, Ecto, Hibernate, Drizzle, Kysely, Prisma 5 to 7, TypeORM, Sequelize and MikroORM handle the same questions.
- [`research/refusing-a-method-in-the-types.md`](research/refusing-a-method-in-the-types.md): the type spike.
- [`projects/nested-mutations/mutation-graph.md`](../nested-mutations/mutation-graph.md): the design record of the statement graph.
- [ADR 164](../../docs/architecture%20docs/adrs/ADR%20164%20-%20Repository%20Layer.md): the ORM client chooses its strategy from capabilities.
- ADR 326: a nested transaction is a savepoint, which is how a multi-statement write runs inside a user's transaction.
- `packages/3-extensions/sql-orm-client/README.md`, sections "Writes without `RETURNING`" and "Reading or writing one record by its key".
