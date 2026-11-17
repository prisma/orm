# SQL query builder

[← Feature-support matrix index](../scorecard.md)

Legend:

- `✅` **Works** — proven by a Prisma 8 **integration** test (one that executes the feature against a database — Postgres via PGlite, SQLite via its real driver, or MongoDB via mongodb-memory-server — and asserts the observable runtime result). Unit-tier tests (SQL/AST/plan/type/snapshot assertions, or any test that never hits a database) do not qualify. Per-database rigor applies: a Postgres integration test cannot justify a SQLite or MongoDB `✅`, and vice versa.
- `🟡` **Untested** — reachable through the Prisma 8 public surface, but no proving Prisma 8 integration test exists yet (evidence left blank). This includes features whose only backing is a unit-tier test.
- `🧪` **Experimental** — shipped in Prisma 8 but outside the stability promise (polymorphism / multi-table inheritance).
- `❌` **Not in 8.0** — deliberately absent from Prisma 8.
- `—` **n/a** — feature does not apply to that database.

| Feature | Postgres | SQLite | MongoDB | Prisma 8 evidence |
| --- | --- | --- | --- | --- |
| `select(...)` (columns / aliased expr / callback record) | ✅ | ✅ | — | `test/integration/test/sql-builder/select.test.ts`; `test/e2e/framework/test/sqlite/sql-builder.test.ts` |
| `insert` | ✅ | ✅ | — | `test/integration/test/sql-builder/mutation.test.ts` (`INSERT returns inserted row via returning`); `test/e2e/framework/test/sqlite/sql-builder.test.ts` (`insert with RETURNING`) |
| `update` | ✅ | ✅ | — | `test/integration/test/sql-builder/mutation.test.ts` (`UPDATE with WHERE returns updated row`); `test/e2e/framework/test/sqlite/sql-builder.test.ts` (`update with WHERE and RETURNING`) |
| `delete` | ✅ | ✅ | — | `test/integration/test/sql-builder/mutation.test.ts` (`DELETE with WHERE returns deleted row`); `test/e2e/framework/test/sqlite/sql-builder.test.ts` (`delete with WHERE and RETURNING`) |
| `innerJoin` | ✅ | 🟡 | — | `test/integration/test/sql-builder/join.test.ts` (`INNER JOIN`); `test/e2e/framework/test/runtime.joins.test.ts` |
| `outerLeftJoin` | ✅ | 🟡 | — | `test/e2e/framework/test/runtime.joins.test.ts` (`LEFT JOIN returns all users including those without posts`) |
| `outerRightJoin` | ✅ | 🟡 | — | `test/e2e/framework/test/runtime.joins.test.ts` (`RIGHT JOIN returns all posts including those without users`) |
| `outerFullJoin` | ✅ | 🟡 | — | `test/e2e/framework/test/runtime.joins.test.ts` (`FULL JOIN returns all users and posts`) |
| `lateralJoin` (capability-gated) | 🟡 | — | — | |
| `outerLateralJoin` (capability-gated) | 🟡 | — | — | |
| `where(...)` predicate | ✅ | ✅ | — | `test/integration/test/sql-builder/where.test.ts`; `test/e2e/framework/test/sqlite/sql-builder.test.ts` (`WHERE filter`) |
| `orderBy(...)` direction (asc/desc) | ✅ | ✅ | — | `test/integration/test/sql-builder/order-by.test.ts`; `test/e2e/framework/test/sqlite/sql-builder.test.ts` (`ORDER BY`) |
| `orderBy(...)` nulls placement (`nulls: first/last`) | 🟡 | 🟡 | — | |
| `groupBy` | ✅ | 🟡 | — | `test/integration/test/sql-builder/group-by.test.ts` (`GROUP BY with COUNT`) |
| `having` | ✅ | 🟡 | — | `test/integration/test/sql-builder/group-by.test.ts` (`HAVING filters groups`) |
| `limit` | ✅ | ✅ | — | `test/integration/test/sql-builder/pagination.test.ts` (`LIMIT restricts row count`); `test/e2e/framework/test/sqlite/sql-builder.test.ts` (`LIMIT and OFFSET`) |
| `offset` | ✅ | ✅ | — | `test/integration/test/sql-builder/pagination.test.ts` (`OFFSET skips rows`); `test/e2e/framework/test/sqlite/sql-builder.test.ts` (`LIMIT and OFFSET`) |
| `distinct()` | ✅ | 🟡 | — | `test/integration/test/sql-builder/distinct.test.ts` (`DISTINCT removes duplicate rows`) |
| `distinctOn` | ✅ | — | — | `test/integration/test/sql-builder/distinct.test.ts` (`DISTINCT ON selects first row per group`) |
| `returning(...)` (capability-gated) | ✅ | ✅ | — | `test/integration/test/sql-builder/mutation.test.ts` (`INSERT returns inserted row via returning`); `test/e2e/framework/test/sqlite/sql-builder.test.ts` (`insert with RETURNING`) |
| `annotate([...])` operation metadata | 🟡 | 🟡 | — | |
| Subquery composition | ✅ | 🟡 | — | `test/integration/test/sql-builder/subquery.test.ts` (`subquery as join source`) |
| `EXISTS` composition | ✅ | 🟡 | — | `test/integration/test/sql-builder/subquery.test.ts` (`EXISTS filters to rows with matching subquery`) |
| `IN` composition | ✅ | 🟡 | — | `test/integration/test/sql-builder/subquery.test.ts` (`IN with subquery and parameters in both parent and subquery`) |
| `eq` function | ✅ | ✅ | — | `test/integration/test/sql-builder/where.test.ts` (`eq filters to matching row`); `test/e2e/framework/test/sqlite/sql-builder.test.ts` (`WHERE filter`) |
| `ne` function | ✅ | 🟡 | — | `test/integration/test/sql-builder/subquery.test.ts` (`IN with subquery and parameters in both parent and subquery` — `fns.ne(f.name, 'Bob')` filters out the non-matching row) |
| `gt` function | ✅ | 🟡 | — | `test/integration/test/sql-builder/where.test.ts` (`gt filters rows`) |
| `gte` function | 🟡 | 🟡 | — | |
| `lt` function | ✅ | 🟡 | — | `test/integration/test/sql-builder/where.test.ts` (`lt filters rows`) |
| `lte` function | 🟡 | 🟡 | — | |
| `and` function | ✅ | 🟡 | — | `test/integration/test/sql-builder/subquery.test.ts` (`IN with subquery` — `fns.and`) |
| `or` function | ✅ | 🟡 | — | `test/integration/test/sql-builder/where.test.ts` (`or within a single where`) |
| `exists` function | ✅ | 🟡 | — | `test/integration/test/sql-builder/subquery.test.ts` (`EXISTS filters to rows with matching subquery`) |
| `notExists` function | 🟡 | 🟡 | — | |
| `in` function | ✅ | 🟡 | — | `test/integration/test/sql-builder/subquery.test.ts` (`IN with subquery`) |
| `notIn` function | 🟡 | 🟡 | — | |
| Aggregate `count` | ✅ | 🟡 | — | `test/integration/test/sql-builder/group-by.test.ts` (`GROUP BY with COUNT`) |
| Aggregate `sum` | 🟡 | 🟡 | — | |
| Aggregate `avg` | 🟡 | 🟡 | — | |
| Aggregate `min` | 🟡 | 🟡 | — | |
| Aggregate `max` | 🟡 | 🟡 | — | |
| Extension operator `ilike` | ✅ | — | — | `test/integration/test/sql-builder/extension-functions.test.ts` (`ilike filters case-insensitively in WHERE`) |
| Extension operator `cosineDistance` | ✅ | — | — | `test/integration/test/sql-builder/extension-functions.test.ts` (`cosineDistance computes distance for identical vectors`) |
| Extension operator `cosineSimilarity` | ✅ | — | — | `test/integration/test/sql-builder/extension-functions.test.ts` (`cosineSimilarity computes similarity for identical vectors`) |
| Capability gating (`lateralJoin` unavailable on SQLite) | — | ✅ | — | `test/e2e/framework/test/sqlite/sql-builder.test.ts` (`lateralJoin is not available`) |
| Field references (column-vs-column comparison) | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/field-reference.test.ts` |
