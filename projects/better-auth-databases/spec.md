# Better Auth adapter: what it knows about each database lives in one place per database

## At a glance

Today an application on Postgres or SQLite sets up the adapter like this, and an application on any other database is refused:

```ts
export const auth = betterAuth({ database: prismaAdapter(db) });
```

After this project the same line works on Postgres, SQLite, MySQL and MariaDB. For a SQL database the adapter does not ship support for, such as a SQL Server package from another company, the application passes that database's support object, published by whoever supports it:

```ts
import { sqlServerSupport } from 'some-sql-server-better-auth-support';

export const auth = betterAuth({
  database: prismaAdapter(db, { targetSupport: sqlServerSupport }),
});
```

The adapter's main code no longer mentions any database. Everything it must know about one database is in that database's support object.

## Why

The adapter (`@prisma/orm-better-auth`) lets Better Auth store its data through an application's Prisma 8 client. Its code knows about Postgres and SQLite in six places:

| What it needs to know | Where it is today |
| --- | --- |
| Which databases it accepts | `src/adapter.ts`, a list of two target names |
| Which kind of JavaScript value each column type reads and writes | `src/models/codec-kinds.ts`, a table of Postgres and SQLite codec ids |
| How to compare text: "contains", "starts with", "ends with", and case-insensitive equality | `src/filters.ts`, raw SQL using `substr`, `length`, `replace` and `lower` |
| Whether two table or column names count as the same name | `src/contract/compare.ts`, a table keyed by target name |
| The database's default namespace | `src/contract/compare.ts`, a table keyed by target name |
| Which PSL types to print for Better Auth's fields | `src/contract/psl-types.ts`, which prints `Uuid` (Postgres only) and plain `String` |

Supporting a new database means editing the adapter in all six places, and an outside author cannot do it at all. Several are also wrong for MySQL and MariaDB:

- `length()` counts bytes, not characters.
- The default collation ignores case and trailing spaces, so even the ORM's own `eq` would match a session token that differs only in case.
- Table and column names follow different case rules.
- A plain `String` becomes `varchar(191)`, which is too short for Better Auth's OAuth tokens and image URLs.

The fix cannot be to make the adapter blind to which database it talks to. Prisma 8's ORM gives each database an interface that suits that database: a method may behave differently, take different arguments or return different things, and some methods exist on only some databases. Whether `like` and `eq` ignore case already differs between databases. An adapter that never knows its database would be correct on a new one only by luck. So the knowledge stays, but in one place per database, behind an interface the adapter publishes.

This follows the repository's rule against branching on the database's name: per-database code goes in an object that the main code looks up, not in `if` statements in the main code. The glossary defines a target as the component that supports one database, so the object is called a **target support**: what this adapter needs to know about one target.

## What we build

### The target support interface

The adapter exports a type, `TargetSupport`, with these members:

- **`target`**: the target name the support is for, as the client's contract reports it (`db.contract.target`, for example `postgres`).
- **`valueKind(codecId)`**: which kind of JavaScript value a codec reads and writes: string, enum, UUID, date, number, boolean, JSON, or other. The adapter uses it to check the contract's field types against what Better Auth needs. For a codec the support does not know it returns `undefined`, and the contract check accepts the field, as it does today. Prisma publishes codec traits at run time, but no trait says which JavaScript value a codec reads, and the ORM does not promise that a column type reads the same kind of value on every database.
- **`compareText(...)`**: builds the ORM condition for every comparison on a text column that Better Auth asks for: `eq`, `ne`, `in`, `not_in`, `contains`, `starts_with` and `ends_with`, each with case respected or ignored. Each database writes this in its own SQL. Case-sensitive `eq` must use the column's index, because Better Auth looks up the session token this way on every request.
- **`sameStorageName(a, b, kind)`**: whether two table names, or two column names, count as the same name on this database. A support has no connection to the server, so where the answer depends on a server setting (MySQL's `lower_case_table_names`), it gives the answer that is safe on every server: names that differ only in case are the same.
- **`defaultNamespace`**: the namespace a model is in when the contract names none (`public` on Postgres, none on SQLite). Prisma records this on the target's descriptor, but the runtime client does not carry the descriptor, so the support states it too. A test checks that each shipped support agrees with its target's descriptor, and `DEVELOPING.md` records the gap.
- **`pslType(field)`**: the PSL type and attributes the contract check and `auth generate` print for a Better Auth field. On MySQL and MariaDB, a string that is an id, unique, indexed, part of a table index, a foreign key or `sortable` stays a plain `String`, because those databases refuse a unique key, an unprefixed index or a foreign key on a text column. Every other string is printed as a text column, so long tokens and URLs fit.

The interface uses the ORM's published types, `Condition` and `OrmRawSqlTag` from `@prisma/orm-family-sql/orm-client`. Where a type it needs is not published, it uses the adapter's own structural type, and the slice records the gap in `DEVELOPING.md`.

Facts that Prisma already publishes are read from Prisma, not repeated in the support:

- Whether a delete can return the deleted row in the same statement is the contract's `returning` capability.
- Whether the database has list columns is the contract's list capability.
- Whether a field holds text, for refusing a text filter on a field that does not, is the codec's published `textual` trait. The adapter sees it as the ORM offering `like` on that field, which it does only for textual codecs, so the client type needs no change. This also covers extension codecs. One such codec, Postgres's case-insensitive `citext`, ignores case even in a case-sensitive comparison; `DEVELOPING.md` records this.

### How the adapter finds the support for a client

1. A client that is not a SQL client is refused first, with a message saying the adapter supports SQL databases.
2. If the application passes `targetSupport` in the adapter's options, the adapter uses it. Its `target` must equal the client's target, or the adapter refuses with a message naming both.
3. Otherwise the adapter uses the support it ships for the client's target.
4. Otherwise it refuses the client, with a message that names the target and says to pass a `targetSupport`.

The adapter ships and exports supports for Postgres, SQLite, MySQL and MariaDB, so an application can extend one, for example to add an extension's codecs. The MariaDB support is built from the MySQL one. The shipped supports contain codec ids, SQL text and functions only. They import no database package, so an application installs no database package beyond its own.

### What does not change

- Better Auth's tables are still models in the application's contract, and `auth generate`, `auth check` and the check on every request work as before on Postgres and SQLite.
- The adapter still imports only the packages Prisma publishes.

## Requirements

1. In `src/`, outside the folder of shipped supports, no string literal is a target name or a codec id (text of the form `name/name@` followed by a version number). A source test fails if one is, as `test/source-imports.test.ts` checks imports today.
2. Better Auth's seven published adapter suites pass on Postgres, SQLite, MySQL and MariaDB, with no test disabled.
3. A support passed through `targetSupport` is used: a test builds one from the adapter's public exports, passes it with a real SQLite client, runs one published suite, and checks that the shipped SQLite support was not used. No test rewrites contract data to fake a target name. The refusal for a SQL target with no shipped support cannot be reached with a real client once all four SQL targets in this repository are shipped, so it is tested on the lookup function, given a list of shipped supports.
4. Moving the Postgres and SQLite knowledge into supports changes no behaviour except the text of the refusal messages. Existing tests change only where they check those messages or call internal functions whose arguments change.
5. Each refusal says what was wrong and what to do.
6. On MySQL and MariaDB, a case-sensitive comparison does not match a value that differs only in case or in trailing spaces, and the session-token lookup uses the index. Tests prove both on the CI servers.
7. Every codec each shipped database's target package publishes has a stated value kind. A test reads the codecs from the published target packages and fails on one the support does not cover. The test may import database packages; the adapter's source may not.
8. On MySQL and MariaDB, the contract `auth generate` prints migrates, and Better Auth's longest values (OAuth tokens, image URLs) are stored without error. A test proves both.
9. The README lists the supported databases and shows how to pass a support. `DEVELOPING.md` explains how to write one and how to run Better Auth's published suites against it. The public interface is checked by the repository's published-interface check.
10. The decision record on library integrations still says an integration accepts only the databases it has been proven correct on. It is updated in place to say that this adapter accepts the databases it ships support for, proven by its tests, and any database whose support the application passes, and that whoever publishes that support is responsible for proving it. Its sentence that an integration "works with whichever database that client is for" is corrected the same way.

## Non-goals

- **MongoDB.** Its ORM client differs from the SQL one in most query methods, and the project's design docs say the two need not be interchangeable. Supporting it needs its own translation layer, not a target support. It is a project of its own.
- **Changes to Prisma's framework or the SQL family.** Everything here is inside the adapter.
- **Atomic counters** (`incrementOne`, which Better Auth uses for rate limits and failed attempts). They need an ORM update by an expression such as `count = count + 1`, which does not exist yet (prisma/orm#30808). It is tracked as its own ticket, so this project can close without waiting for the ORM.
- **Moving the adapter to its own repository.** That is planned for when Prisma 8 reaches general availability, and this project adds nothing that would stop it.

## Risks

- **The interface is published, so a wrong shape is costly to change.** It is built inside the package from the Postgres and SQLite supports first, and published only once the MySQL and MariaDB supports have shaped it. Until 8.0.0 it is a release candidate and may still change.
- **MySQL and MariaDB compare text by collation.** A comparison that names a binary collation stops the database using the index, and the binary collation both databases share (`utf8mb4_bin`) still ignores trailing spaces. The supports compare in two steps: an indexed comparison in the column's own collation, then a comparison of the bytes (`CAST(col AS BINARY) = CAST(? AS BINARY)`) on the rows it finds. This is taken from the databases' manuals and must be confirmed on the CI servers first in the slice.
- **Better Auth's counter fallback may fail on MySQL.** Under MySQL's default isolation level, Better Auth's `incrementOne` fallback may use up its five retries inside a transaction. The MySQL slice tests it; if it fails, the README states the limit until the ORM has an atomic update.
- **MySQL tests need a database per test file.** The CI servers' URLs name the `mysql` system database, so the test setup creates and drops its own databases.

## Definition of done

- Every requirement above is met, and every slice in `plan.md` is merged or dropped with a reason recorded there.
- The example app (`examples/better-auth`) runs in CI on Postgres, as today, and on MySQL.
- The decision record, README and `DEVELOPING.md` describe the result, and this folder is deleted in the close-out pull request.
