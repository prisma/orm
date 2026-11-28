# What MySQL reports after a write, and what the ORM client's write methods could return there

Research for the design of how the ORM client builds writes. Status on 2026-11-25: the facts about MySQL are checked against its manual where marked; the returns in the last column were agreed on 2026-11-25, except `upsert()`, which is still open.

## Why this note exists

The ORM client's interface is adapted to each database target. A method may differ between targets in what it does, whether it exists, its parameters and what it returns, as long as a user of one target is reasonably familiar with another. Code that runs unchanged on every database is not a goal.

For a database without `RETURNING`, that raises the question of what each write method should return. The answer should follow what a developer of that database expects, so this note records what MySQL itself reports after each kind of write. It is kept so that the project's close-out can document how the MySQL interface balanced what is idiomatic for the target against consistency with the other targets.

## What MySQL reports

MySQL has no `RETURNING` clause on `INSERT`, `UPDATE` or `DELETE`. A write answers with a count of affected rows and, for an insert, at most one generated value. To see a row after writing it, a MySQL developer sends a `SELECT` by key.

| ORM client method | Closest MySQL statement | What MySQL reports back | Return on MySQL |
| --- | --- | --- | --- |
| `create()` | `INSERT … VALUES (…)` | The affected-row count, and the insert id: the value generated for an `AUTO_INCREMENT` column. No other column values. | The record's key |
| `createAll()` | `INSERT … VALUES (…), (…)` | The count of rows inserted, and the insert id of the first inserted row only. | A count |
| `createAll()` skipping rows that collide | `INSERT IGNORE …` | The count of rows actually inserted. It does not say which rows were skipped. | A count |
| `update()` | `UPDATE … WHERE key = ?` | A count. By default it counts rows whose values actually changed. When the connection sets `CLIENT_FOUND_ROWS`, it counts rows the `WHERE` clause matched. | A count, 0 or 1 |
| `updateAll()` | `UPDATE … WHERE …`, with optional `ORDER BY … LIMIT n` | The same count. | A count |
| `delete()` | `DELETE … WHERE key = ?` | The count of rows deleted. | A count, 0 or 1 |
| `deleteAll()` | `DELETE … WHERE …`, with optional `ORDER BY … LIMIT n` | The same count. | A count |
| `upsert()` | `INSERT … ON DUPLICATE KEY UPDATE …` | A count per row that says what happened: 1 when the row was inserted, 2 when an existing row was updated, 0 when an existing row was set to its current values (1 instead of 0 with `CLIENT_FOUND_ROWS`). | Not proposed yet |

With these returns, each plain write is one statement on MySQL. None reads rows before or after the write, so none needs a list of keys as long as its result, and the ORM client opens no transaction of its own for them.

## Where each fact comes from

Checked against the MySQL 8.4 Reference Manual and C API manual on 2026-11-25:

- **No `RETURNING`.** The syntax sections of [`INSERT`](https://dev.mysql.com/doc/refman/8.4/en/insert.html), [`UPDATE`](https://dev.mysql.com/doc/refman/8.4/en/update.html) and [`DELETE`](https://dev.mysql.com/doc/refman/8.4/en/delete.html) list none.
- **Insert id of the first row only.** [`LAST_INSERT_ID()`](https://dev.mysql.com/doc/refman/8.4/en/information-functions.html) and [`mysql_insert_id()`](https://dev.mysql.com/doc/c-api/8.4/en/mysql-insert-id.html).
- **The ids of one multi-row insert are not guaranteed consecutive by default.** [`AUTO_INCREMENT` handling in InnoDB](https://dev.mysql.com/doc/refman/8.4/en/innodb-auto-increment-handling.html): the default lock mode in 8.4 is interleaved, in which the values one statement generates "may not be consecutive"; they are consecutive only in the two other lock modes, or when nothing but simple inserts is running. So the keys of several inserted rows cannot be worked out from the first insert id.
- **Changed rows by default, matched rows with `CLIENT_FOUND_ROWS`.** [`mysql_affected_rows()`](https://dev.mysql.com/doc/c-api/8.4/en/mysql-affected-rows.html). The MySQL driver in this repository sets the flag (`foundRows: true` in its connection options), so an `UPDATE` reports the rows it matched.
- **Upsert counts of 1, 2 and 0.** [`INSERT … ON DUPLICATE KEY UPDATE`](https://dev.mysql.com/doc/refman/8.4/en/insert-on-duplicate.html) and `mysql_affected_rows()`.
- **An upsert fires on a duplicate in any unique index or the primary key,** and the statement has no way to name which one. The same page advises against the clause on tables with several unique indexes.
- **`ORDER BY` and `LIMIT` on single-table `UPDATE` and `DELETE`.** The syntax sections of both pages.
- **`INSERT IGNORE` does not count the rows it skips.** The `INSERT` page describes the count of duplicates in the statement's information string; the sentence about discarding the row was read through a summary, not directly.

Not confirmed, and not to be relied on until someone reads the source:

- **Whether rows deleted by a foreign-key cascade are counted.** The `DELETE` page says only that the statement returns the number of deleted rows.
- **The idiom `id = LAST_INSERT_ID(id)` in the update clause of an upsert,** which makes the insert id the row's key whether the row was inserted or updated. The 8.4 page for `ON DUPLICATE KEY UPDATE` does not show it. It says that `LAST_INSERT_ID()` returns the `AUTO_INCREMENT` value when the statement inserts or updates a row. What an upsert can report about the key needs a test against a server before `upsert()` is designed.

## What this says about MySQL's idioms

- A write answers with a count and at most one generated id. The proposed returns are that reply.
- `ORDER BY … LIMIT` on `UPDATE` and `DELETE` is native, so "at most n of the matching rows" is one statement on MySQL. PostgreSQL needs a subquery for the same thing.
- An upsert tells the caller whether it created or updated. A bare count of 1 or 2 carries that only by convention, which is why `upsert()` has no proposed return yet.

## MariaDB

MariaDB has `INSERT … RETURNING` and `DELETE … RETURNING`. Its documentation for [`UPDATE`](https://mariadb.com/kb/en/update/) says `UPDATE … RETURNING` is available from MariaDB 13.0. The MariaDB adapter in this repository describes a MariaDB 10.11 server and reports `returning` as off, because the capability covers all three statements and 10.11 has no `UPDATE … RETURNING`. Splitting the capability by statement kind would let `create()` and `delete()` return the record on MariaDB 10.11. That is outside this project.

## Related research

How other libraries handle writes that return rows, row locks, affected-row checks and MySQL's refusal of a write that reads its own table was researched for the same design: Active Record, Django, SQLAlchemy, Ecto, Hibernate, Drizzle, Kysely, Prisma 5 to 7, TypeORM, Sequelize and MikroORM. Those notes are in [`prior-art/classic-orms.md`](prior-art/classic-orms.md) and [`prior-art/typescript-libraries.md`](prior-art/typescript-libraries.md). What the compiler and the editor show for each way of refusing a method in the types is in [`refusing-a-method-in-the-types.md`](refusing-a-method-in-the-types.md).
