# Slice 6b — MariaDB runtime: queries, includes and writes; the example reads and writes

**Linear:** [TML-3697](https://linear.app/prisma-company/issue/TML-3697). **Builds on:** slice 6a (`slices/mariadb-control/`), which gave MariaDB its target, control adapter, driver, public packages and example app for migrations. **Include design:** [`include-loading-design.md`](./include-loading-design.md).

## Decision

MariaDB gets a runtime of its own, built from MySQL's: `mariadb()` in `@prisma/orm-mariadb/runtime`, a MariaDB runtime adapter, and a MariaDB SQL renderer that subclasses MySQL's. MariaDB loads includes with one query per relation, a strategy the ORM client gains for any database that cannot run its one-query include correctly (see the include design). The slice is delivered in two pull requests:

- **6b-1, per-relation includes.** The ORM client's per-relation strategy (`'query'`), built as a statement graph for reads and writes, and the capabilities that select it: `sql.jsonAgg` and the new `sql.outerReferencesInDerivedTables` and `sql.jsonAggWithoutTruncation`. Tested on Postgres with the two new capabilities switched off. No MariaDB runtime code.
- **6b-2, MariaDB runtime.** Everything else in this spec, on top of 6b-1.

```ts
import { mariadb } from '@prisma/orm-mariadb/runtime'

const db = mariadb({ contract, url: process.env['MARIADB_URL'] })

const users = await db.orm.User
  .include('posts', (posts) => posts.orderBy((post) => post.id.desc()).limit(3))
  .all()
await db.orm.User.upsert({
  create: { email: 'a@example.com' },
  update: { role: 'ADMIN' },
  conflictOn: { email: 'a@example.com' },
})
```

Today, pointed at MariaDB, `mysql()` fails every connection (MariaDB 10.11 has no `transaction_isolation` variable), every include (MariaDB cannot resolve an outer reference inside a derived table) and every upsert (MariaDB rejects MySQL's `INSERT … AS new` row alias).

## Requirements

- **R1.** `mariadb()` runs every ORM read and write against MariaDB 10.11, with the same results as `mysql()` on MySQL 8.4, except where a difference is stated in a test.
- **R2.** `examples/prisma-8-demo-mariadb` reads and writes against MariaDB 10.11 in CI.
- **R3.** MySQL's behaviour, and the SQL it sends, do not change.
- **R4.** Every error raised while running against MariaDB names MariaDB, and says something true about it.
- **R5.** No code is copied from MySQL; MariaDB reuses it through parameters and subclasses, as slice 6a did.

## Design

### 1. Per-relation includes (6b-1)

As specified in [`include-loading-design.md`](./include-loading-design.md). MariaDB's adapter reports `jsonAgg` but neither `outerReferencesInDerivedTables` nor `jsonAggWithoutTruncation`, so every MariaDB include is loaded per relation.

### 2. The SQL renderer

MySQL's SQL renderer, today a set of module functions in `packages/3-targets/mysql/1-mysql/2-adapter/src/core/sql-renderer.ts`, becomes a class, `MysqlSqlRenderer`, exported from an internal subpath of the MySQL adapter. Only the methods MariaDB overrides are `protected`; the rest are `private`.

Before the conversion, the SQL of every MySQL renderer test input and every query in MySQL's live tests is captured as a snapshot by rendering it without a database. The conversion is its own commit and leaves every snapshot unchanged (R3).

MariaDB's adapter subclasses it as `MariadbSqlRenderer` and overrides exactly one thing, the upsert: it writes no row alias, and writes the proposed row's column as `VALUES(c)` where MySQL writes `new.c`. MariaDB 10.11 and 11.4 accept `VALUES(c)` without a deprecation warning, for any number of inserted rows.

MariaDB never renders the one-query include, so it needs none of MySQL's include rendering or the `/*+ SET_VAR */` hint that goes with it.

### 3. The runtime target and adapter

MySQL's runtime target descriptor and runtime adapter get factories that take what MariaDB changes, as slice 6a did for the control plane:

- the runtime target: the target id and descriptor metadata;
- the runtime adapter: the target id, the profile, the capabilities and the renderer.

MySQL's own descriptors become those factories applied to MySQL's values. The runtime adapter's `profile.target` is the target id it is built with: `'mariadb'` for MariaDB.

### 4. `mariadb()`

`createMysqlClient({ target, adapter, driver, urlSchemes })` in the MySQL facade builds a client function for MySQL or a database that extends it. The display name comes from the target's metadata. `mysql()` is `createMysqlClient` applied to MySQL's components. `MysqlOptions` and `MysqlClient` take a target-id type parameter.

`@prisma/orm-mariadb` gains:

- `/runtime`: `mariadb()`, built from MariaDB's components, with `MariadbOptions` and `MariadbClient`;
- `/static`: the static context, built the same way.

`mariadb()` accepts `mariadb://` and `mysql://` URLs. A contract whose target is not `mariadb` fails with the runtime's target-mismatch error.

### 5. Errors

Each error message in the MySQL renderer, driver and facade is checked against MariaDB. A message true of both databases takes the display name it is built with. A message not true of MariaDB is overridden in MariaDB's subclass: for example, MySQL's renderer refuses `RETURNING` because "MySQL has no RETURNING", but MariaDB has `INSERT … RETURNING` and `DELETE … RETURNING`, so MariaDB's message says it does not use them. Errors raised by codecs and the SQL lexer in the shared MySQL target package drop `meta.target`, since the same code serves both databases.

### 6. Tests and the example

- MySQL's ORM live test files (`orm-reads`, `orm-includes`, `orm-writes`, `raw-lane`) run against both MySQL and MariaDB. Each difference between the two is stated in the test that shows it.
- `examples/prisma-8-demo-mariadb` gains MySQL's runtime files: the client, the queries, the seed and their tests. It runs against MariaDB 10.11 in the Test Examples CI job.

## Requirements met

| Requirement | Met by |
| --- | --- |
| R1 every read and write | Sections 1–4; live tests on both servers |
| R2 example | Section 6 |
| R3 MySQL unchanged | Renderer snapshots (section 2); MySQL's tests unchanged |
| R4 true errors | Section 5 |
| R5 no copies | Sections 2–4: factories and subclasses |

## Out of scope

- Splitting the `returning` capability by statement kind: MariaDB has `INSERT … RETURNING` and `DELETE … RETURNING`, but every write already works without them. Recorded in `deferred.md`.
- `onConflict: 'skip'`, which stays refused on MySQL and MariaDB.
- JSON and boolean column types, which MySQL does not have yet.

## Done when

`examples/prisma-8-demo-mariadb` reads and writes against MariaDB 10.11 in CI; MySQL's ORM live tests pass against MySQL and MariaDB, with each difference stated; and MySQL's rendered SQL is unchanged.
