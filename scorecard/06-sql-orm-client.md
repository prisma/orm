# SQL ORM client

[← Feature-support matrix index](../scorecard.md)

Legend:

- `✅` **Works** — proven by a Prisma Next **integration** test (one that executes the feature against a database — Postgres via PGlite, SQLite via its real driver, or MongoDB via mongodb-memory-server — and asserts the observable runtime result). Unit-tier tests (SQL/AST/plan/type/snapshot assertions, or any test that never hits a database) do not qualify. Per-database rigor applies: a Postgres integration test cannot justify a SQLite or MongoDB `✅`, and vice versa.
- `🟡` **Untested** — reachable through the Prisma Next public surface, but no proving Prisma Next integration test exists yet (evidence left blank). This includes features whose only backing is a unit-tier test.
- `🧪` **Experimental** — shipped in Prisma Next but outside the stability promise (polymorphism / multi-table inheritance).
- `❌` **Not in 8.0** — deliberately absent from Prisma Next.
- `—` **n/a** — feature does not apply to that database.

| Feature | Postgres | SQLite | MongoDB | Prisma Next evidence |
| --- | --- | --- | --- | --- |
| `where(...)` (callback / where input / shorthand) | ✅ | ✅ | — | `test/integration/test/sql-orm-client/mn-filter.test.ts`; `test/e2e/framework/test/sqlite/orm.test.ts` (`findMany › with filter`) |
| `select(...)` projection | ✅ | ✅ | — | `test/integration/test/sql-orm-client/include.test.ts`; `test/e2e/framework/test/sqlite/orm.test.ts` |
| `orderBy(...)` | ✅ | ✅ | — | `test/integration/test/sql-orm-client/self-relations.test.ts` (`orderBy on a depth-1 self-relation`); `test/e2e/framework/test/sqlite/orm.test.ts` (`with ordering`) |
| `limit` | ✅ | ✅ | — | `test/integration/test/sql-orm-client/pagination.test.ts` (`limit() and offset() apply limit and offset`); `test/e2e/framework/test/sqlite/orm.test.ts` (`with limit and offset`) |
| `offset` | ✅ | ✅ | — | `test/integration/test/sql-orm-client/pagination.test.ts` (`limit() and offset() apply limit and offset`); `test/e2e/framework/test/sqlite/orm.test.ts` (`with limit and offset`) |
| `cursor(...)` keyset pagination | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/pagination.test.ts` (`cursor() applies forward and backward boundaries`) |
| `distinct(...)` | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/pagination.test.ts` (`distinct() returns unique values for selected fields`) |
| `distinctOn(...)` | ✅ | — | — | `test/integration/test/sql-orm-client/pagination.test.ts` (`distinctOn() keeps one row per key using orderBy precedence`) |
| `first()` | ✅ | ✅ | — | `test/integration/test/sql-orm-client/first.test.ts`; `test/e2e/framework/test/sqlite/orm.test.ts` (`findFirst`) |
| `all()` result retrieval | ✅ | ✅ | — | `test/integration/test/sql-orm-client/include.test.ts`; `test/integration/test/sql-orm-client/codec-async.test.ts` (`for await` iteration over `all()`); `test/e2e/framework/test/sqlite/orm.test.ts` (`findMany › returns all rows`) |
| `create` | ✅ | ✅ | — | `test/integration/test/sql-orm-client/create.test.ts`; `test/e2e/framework/test/sqlite/orm.test.ts` (`create`) |
| `createAll` | ✅ | ✅ | — | `test/integration/test/sql-orm-client/create.test.ts`; `test/e2e/framework/test/sqlite/orm.test.ts` (`createAll`) |
| `createAndCount` | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/create.test.ts` (`createAndCount`) |
| `update` | ✅ | ✅ | — | `test/integration/test/sql-orm-client/update.test.ts`; `test/e2e/framework/test/sqlite/orm.test.ts` (`update`) |
| Empty-data `update` returns the matched row | ❌ | 🟡 | — | `test/integration/test/ports/prisma/functional/extended-where/extended-where.test.ts` (`update with where 1 unique (PK)`) |
| `updateAll` | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/update.test.ts` (`updateAll`) |
| `updateAndCount` | ✅ | ✅ | — | `test/integration/test/sql-orm-client/update.test.ts` (`updateAndCount`, one write statement); `test/integration/test/sql-orm-client/count-terminal-interleaving.test.ts` (SQLite real-driver write-derived count) |
| `delete` | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/delete.test.ts` (`delete`) |
| `deleteAll` | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/delete.test.ts` (`deleteAll`) |
| `deleteAndCount` | ✅ | ✅ | — | `test/integration/test/sql-orm-client/delete.test.ts` (`deleteAndCount`, one write statement); `test/e2e/framework/test/sqlite/orm.test.ts` (`deleteAndCount`) |
| `upsert` (conflict fallback + explicit criteria) | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/upsert.test.ts` |
| Mutation result reload by `Bytes` primary/unique key | ❌ | 🟡 | — | `test/integration/test/ports/prisma/functional/bytes-upsert/bytes-upsert.test.ts`; `test/integration/test/ports/prisma/functional/issues-27455-bytes-id/issues-27455-bytes-id.test.ts` |
| `aggregate(spec)` | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/aggregate.test.ts` |
| `groupBy` | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/group-by.test.ts` (`groupBy().aggregate() returns grouped counts`) |
| `GroupedCollection.having` | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/group-by.test.ts` (`having((having) => having.count().gt(1))`) |
| `GroupedCollection.aggregate` | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/group-by.test.ts` (`groupBy().aggregate()`) |
| `include(relation, refine?)` eager load | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/include.test.ts` |
| Registered collection methods / subclasses | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/orm.test.ts` |
| Execution mutation default: generated id | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/create.test.ts` (`execution mutation defaults`); `test/integration/test/sql-orm-client/collection-mutation-defaults.test.ts` |
| Execution mutation default: `@updatedAt` | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/collection-mutation-defaults.test.ts` |
| Comparison operator `eq` | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/first.test.ts` (`user.id.eq(2)`) |
| Comparison operator `neq` | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/field-reference.test.ts` (`u.name.neq('Bob')`) |
| Comparison operator `in` | 🟡 | 🟡 | — | |
| Comparison operator `notIn` | 🟡 | 🟡 | — | |
| Comparison operator `gt` | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/aggregate.test.ts` (`post.views.gt(999)`) |
| Comparison operator `lt` | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/field-reference.test.ts` (`BinaryExpr.lt` column comparison) |
| Comparison operator `gte` | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/aggregate.test.ts` (`post.views.gte(20)`) |
| Comparison operator `lte` | 🟡 | 🟡 | — | |
| Comparison operator `isNull` | 🟡 | 🟡 | — | |
| Comparison operator `isNotNull` | 🟡 | 🟡 | — | |
| `like` textual filter | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/ilike.test.ts` (`u.name.like('%Ali%')`) |
| `ilike` textual filter | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/ilike.test.ts` (`u.name.ilike('%Ali%')`) |
| String `contains` first-class helper | 🟡 | 🟡 | — | |
| String `startsWith` first-class helper | 🟡 | 🟡 | — | |
| String `endsWith` first-class helper | 🟡 | 🟡 | — | |
| `findUniqueOrThrow` / `findFirstOrThrow` terminal | ❌ | ❌ | — | |
| Per-query / global `omit` | ❌ | ❌ | — | |
| `createMany({ skipDuplicates })` | ❌ | ❌ | — | |
| `updateMany({ limit })` | ❌ | ❌ | — | |
| `relationLoadStrategy: 'query' \| 'join'` | ❌ | ❌ | — | |
| `Prisma.skip` | ❌ | ❌ | — | |
| `strictUndefinedChecks` | ❌ | ❌ | — | |
| `findUnique` auto-batching (dataloader) | ❌ | ❌ | — | |

Count terminals use the write statement's native statistic. Postgres reports command-tag matched rows, including no-op updates; SQLite reports `StatementSync.run().changes` (`sqlite3_changes64()`), so its count is target-specific rather than a cross-database normalization. `updateAndCount` support is shipped and proven for both SQL targets; the SQLite interleaving test exercises the real SQLite driver and asserts the write-derived count. `deleteAndCount` has SQLite end-to-end evidence above.
