# Plan: Better Auth adapter, one place per database

The spec is [spec.md](spec.md). Each slice is one pull request. Slices run in the order below, because each changes the same few files (`src/adapter.ts`, `src/filters.ts`, `src/contract/compare.ts`) and the target support interface that the first slice creates.

| # | Slice | Depends on | Status |
| --- | --- | --- | --- |
| 1 | Target supports for Postgres and SQLite, inside the package | none | Not started |
| 2 | MySQL and MariaDB, and the published interface | 1 | Not started |
| 3 | JSON and list fields stored natively | 2 | Not started |
| 4 | One-time tokens read and deleted in one statement | 2 | Not started |
| 5 | Better Auth's remaining test suites and race tests | 2, 4 | Not started |

## 1. Target supports for Postgres and SQLite, inside the package

Move what the adapter knows about Postgres and SQLite out of the main code into two target supports, in a folder of their own (`src/targets/`), and look the support up by the client's target. The interface stays internal to the package, so it can still change freely; there is no `targetSupport` option yet. No behaviour changes for an application on Postgres or SQLite.

- The six places listed in the spec's "Why" read from the support.
- A text filter on a field that does not hold text is refused when the ORM offers no `like` on the field, which follows the codec's `textual` trait. The refusal happens inside the ORM's `where` callback, where the field is available.
- A non-SQL client is refused before the lookup.
- The source test from the spec's requirement 1, the codec-coverage test from requirement 7, and a test that each support's default namespace matches its target's descriptor, for Postgres and SQLite.
- `DEVELOPING.md` is corrected: it says the ORM cannot delete one row and return it, which is wrong (Linear TML-3922).

## 2. MySQL and MariaDB, and the published interface

Ship supports for MySQL and MariaDB, the MariaDB one built from the MySQL one, and run Better Auth's seven suites on both in CI.

- **Test setup.** The package-test CI job already starts MySQL 8.4 and MariaDB servers (`MYSQL_URL`, `MARIADB_URL` in `.github/workflows/ci.yml`), but their URLs name the `mysql` system database, so the setup creates and drops a database per test file. Add `@prisma/orm-mysql` and `@prisma/orm-mariadb` as development dependencies. Extend the tests that loop over every target. `DEVELOPING.md` says how to start both servers locally.
- **Text comparison.** First confirm, with one query on each CI server, which collations ignore trailing spaces. Then write comparisons that count characters, not bytes. Case-sensitive comparisons find rows with an indexed comparison in the column's collation, then compare bytes, so neither case nor trailing spaces are ignored, whatever the column's character set. Case-insensitive comparisons are written in the support and checked by Better Auth's case-insensitive suite. Tests check the query plan of the session-token lookup.
- **Names.** `sameStorageName` treats names that differ only in case as the same, for tables and columns, which is right whatever the server's `lower_case_table_names` setting.
- **PSL.** `pslType` follows the spec's rule for MySQL strings. Tests migrate the printed contract and store Better Auth's longest values.
- **One-time tokens.** Neither database reports the `returning` capability, so Better Auth keeps its own `consumeOne` there.
- **Counters.** A test runs Better Auth's `incrementOne` fallback under contention inside a transaction. If it fails, the README states the limit.
- **Publish the interface.** Export `TargetSupport` and the four shipped supports, add the `targetSupport` option and the lookup the spec describes, regenerate the published-interface file, and add the tests from requirement 3.
- **Docs.** README, `DEVELOPING.md`, the decision record on library integrations (requirements 9 and 10), and the release-note entry the repository's release-notes check requires.
- **Example app.** It gains a MySQL configuration with its own emitted contract, run in CI.

## 3. JSON and list fields stored natively

Today the adapter tells Better Auth it supports neither JSON values nor lists, so Better Auth turns them into text on every database, and the README tells users to declare those fields as `String`. Instead, the adapter tells Better Auth it supports both, and converts per field with Better Auth's `customTransformInput` and `customTransformOutput` hooks:

- A field whose codec's value kind is JSON stores the JSON value. A field declared `String` gets the value as text, as today. Existing contracts keep working, so this is not a breaking change.
- A list field is stored as a list where the contract reports the list capability (Postgres today), and as text elsewhere.
- Filter values pass through the same hooks, so a filter on a field compares the form the field stores. A JSON value that is itself a string is stored as a JSON string, not parsed. MySQL's JSON columns cannot be compared with `eq`; a filter on one is refused with a message.
- The contract check and `auth generate` accept both forms, and print the native one where the database has it.
- Better Auth's `supportsUUIDs` setting is not part of this slice: it means the database generates ids, not that ids are stored in `uuid` columns, which already works.

## 4. One-time tokens read and deleted in one statement

Better Auth reads and deletes a one-time token, such as a verification code, through the adapter's optional `consumeOne`. Without it, Better Auth finds the row and then deletes it with a guard on every column. That is already safe under contention, but it takes two round trips. The guard can also refuse a valid token when a column value does not read back exactly as it was written, for example a timestamp with more precision than JavaScript keeps.

- Where the contract reports the `returning` capability (Postgres and SQLite), implement `consumeOne` with the ORM's `delete()`, passing Better Auth's filter as given. When the filter covers a whole unique key, as Better Auth's callers' filters do, only one of several concurrent callers gets the row. Elsewhere leave it to Better Auth.
- Race tests: many concurrent consumers of one token, and exactly one gets it.
- A test with a timestamp column that keeps microseconds: Better Auth's fallback refuses the valid token, and the adapter's `consumeOne` accepts it.

## 5. Better Auth's remaining test suites and race tests

Adopt every test Better Auth runs against its own adapters that ours does not run yet: the suites that live only in Better Auth's repository (SCIM over HTTP, CIMD refresh, compound index, email lookup, under `e2e/adapter/test/` there) and the contention tests the official and community adapters run. Run them on every database the adapter ships support for.

## Related work outside this plan

- Atomic counters (`incrementOne`): waits for an ORM update by an expression (prisma/orm#30808). Under contention, Better Auth's fallback gives up after five tries, and this is the gap users are most likely to notice. Linear TML-3981.
- Linear TML-3957: test against Better Auth 1.7.28, which shares its contract-check registry across copies of `@better-auth/core`, and correct the README's statement that only one copy works.
- MongoDB support is a project of its own (see the spec's non-goals).
