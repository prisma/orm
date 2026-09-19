# Raw & typed SQL

[← Feature-support matrix index](../scorecard.md)

Legend:

- `✅` **Works** — proven by a Prisma 8 **integration** test (one that executes the feature against a database — Postgres via PGlite, SQLite via its real driver, or MongoDB via mongodb-memory-server — and asserts the observable runtime result). Unit-tier tests (SQL/AST/plan/type/snapshot assertions, or any test that never hits a database) do not qualify. Per-database rigor applies: a Postgres integration test cannot justify a SQLite or MongoDB `✅`, and vice versa.
- `🟡` **Untested** — reachable through the Prisma 8 public surface, but no proving Prisma 8 integration test exists yet (evidence left blank). This includes features whose only backing is a unit-tier test.
- `🧪` **Experimental** — shipped in Prisma 8 but outside the stability promise (polymorphism / multi-table inheritance).
- `❌` **Not in 8.0** — deliberately absent from Prisma 8.
- `—` **n/a** — feature does not apply to that database.

| Feature | Postgres | SQLite | MongoDB | Prisma 8 evidence |
| --- | --- | --- | --- | --- |
| `rawSql` expression inside typed builder | ✅ | ✅ | — | `test/integration/test/sql-builder/raw-sql.integration.test.ts`; `test/e2e/framework/test/sqlite/raw-sql.test.ts` |
| Statement-level `raw` SQL tag (`client.raw`) | 🟡 | 🟡 | — | |
| Raw Mongo client | — | — | 🟡 | |
| `Prisma.sql` fragment | ❌ | ❌ | — | |
| `Prisma.join` fragment | ❌ | ❌ | — | |
| `Prisma.raw` fragment | ❌ | ❌ | — | |
| `Prisma.empty` fragment | ❌ | ❌ | — | |
| Typed generics for SQL fragments | ❌ | ❌ | — | |
| TypedSQL (`.sql` files → typed functions) | ❌ | ❌ | — | |
