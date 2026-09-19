# Filtering

[← Feature-support matrix index](../scorecard.md)

Legend:

- `✅` **Works** — proven by a Prisma 8 **integration** test (one that executes the feature against a database — Postgres via PGlite, SQLite via its real driver, or MongoDB via mongodb-memory-server — and asserts the observable runtime result). Unit-tier tests (SQL/AST/plan/type/snapshot assertions, or any test that never hits a database) do not qualify. Per-database rigor applies: a Postgres integration test cannot justify a SQLite or MongoDB `✅`, and vice versa.
- `🟡` **Untested** — reachable through the Prisma 8 public surface, but no proving Prisma 8 integration test exists yet (evidence left blank). This includes features whose only backing is a unit-tier test.
- `🧪` **Experimental** — shipped in Prisma 8 but outside the stability promise (polymorphism / multi-table inheritance).
- `❌` **Not in 8.0** — deliberately absent from Prisma 8.
- `—` **n/a** — feature does not apply to that database.

| Feature | Postgres | SQLite | MongoDB | Prisma 8 evidence |
| --- | --- | --- | --- | --- |
| Equality `eq` | ✅ | ✅ | ✅ | `test/integration/test/sql-builder/where.test.ts`; `test/e2e/framework/test/sqlite/sql-builder.test.ts`; `test/integration/test/mongo/orm.test.ts` |
| Comparison `ne` | ✅ | 🟡 | 🟡 | `test/integration/test/sql-builder/subquery.test.ts` (`IN with subquery and parameters in both parent and subquery` — `fns.ne(f.name, 'Bob')` filters out the non-matching row) |
| Comparison `gt` | ✅ | 🟡 | 🟡 | `test/integration/test/sql-builder/where.test.ts` (`gt filters rows`) |
| Comparison `gte` | 🟡 | 🟡 | 🟡 | |
| Comparison `lt` | ✅ | 🟡 | 🟡 | `test/integration/test/sql-builder/where.test.ts` (`lt filters rows`) |
| Comparison `lte` | 🟡 | 🟡 | 🟡 | |
| `in` | ✅ | 🟡 | 🟡 | `test/integration/test/sql-builder/subquery.test.ts` (`IN with subquery`) |
| `notIn` | 🟡 | 🟡 | 🟡 | |
| `and` combinator | ✅ | 🟡 | 🟡 | `test/integration/test/sql-builder/subquery.test.ts` (`fns.and`) |
| `or` combinator | ✅ | 🟡 | 🟡 | `test/integration/test/sql-builder/where.test.ts` (`or within a single where`) |
| `not` combinator | 🟡 | 🟡 | ✅ | `test/integration/test/mongo/orm.test.ts` (`where() with .not() excludes matching documents`) |
| `exists` | ✅ | 🟡 | — | `test/integration/test/sql-builder/subquery.test.ts` (`EXISTS`) |
| `notExists` | 🟡 | 🟡 | — | |
| `IS NULL` / `IS NOT NULL` | ✅ | 🟡 | — | `test/integration/test/sql-builder/where.test.ts` (`eq(col, null) produces IS NULL`) |
| Textual `like` | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/ilike.test.ts` (`u.name.like('%Ali%')`) |
| Textual `ilike` | ✅ | 🟡 | — | `test/integration/test/sql-orm-client/ilike.test.ts`; `test/integration/test/sql-builder/extension-functions.test.ts` |
| Column-vs-column comparison | ✅ | 🟡 | ✅ | `test/integration/test/sql-orm-client/field-reference.test.ts`; `test/integration/test/mongo/expr-filter.test.ts` |
| Full-text search + relevance | 🟡 | — | 🟡 | |
| `mode: 'insensitive'` on comparisons | ❌ | ❌ | — | |
| JSON-path filtering + `JsonNull`/`DbNull`/`AnyNull` | ❌ | ❌ | — | |
| Scalar-list filter `has` | ❌ | ❌ | — | |
| Scalar-list filter `hasEvery` | ❌ | ❌ | — | |
| Scalar-list filter `hasSome` | ❌ | ❌ | — | |
| Scalar-list filter `isEmpty` | ❌ | ❌ | — | |
