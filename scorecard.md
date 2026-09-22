# Prisma 8 — Feature-Support Matrix (RC1)

This is the Prisma 8 feature-support matrix feeding PR #986 (the Prisma 8 RC1 release). Each row is one feature; the three data columns state **whether that feature is available in Prisma 8** for **Postgres**, **SQLite**, and **MongoDB** — not whether Prisma 7 had it. The matrix lists *all* features Prisma 8 exposes (mined from `prisma-8-api.md`), plus every notable Prisma 7 feature Prisma 8 lacks, so that absences are named rather than silently missing. The **Prisma 8 evidence** column points only to Prisma 8 (TypeScript) test suites; Rust/engine tests and Prisma 7 tests are never cited here. When a cell is `🟡` the evidence is intentionally empty — that emptiness is what makes it untested rather than proven.

The matrix is split by category across the [`scorecard/`](scorecard/) directory — this page is the index. Each category file is self-contained (it repeats the legend below) and holds that category's table(s) verbatim. Follow the links in the [Categories](#categories) section to reach a specific category.

Legend:

- `✅` **Works** — proven by a Prisma 8 **integration** test (one that executes the feature against a database — Postgres via PGlite, SQLite via its real driver, or MongoDB via mongodb-memory-server — and asserts the observable runtime result). Unit-tier tests (SQL/AST/plan/type/snapshot assertions, or any test that never hits a database) do not qualify. Per-database rigor applies: a Postgres integration test cannot justify a SQLite or MongoDB `✅`, and vice versa.
- `🟡` **Untested** — reachable through the Prisma 8 public surface, but no proving Prisma 8 integration test exists yet (evidence left blank). This includes features whose only backing is a unit-tier test.
- `🧪` **Experimental** — shipped in Prisma 8 but outside the stability promise (polymorphism / multi-table inheritance).
- `❌` **Not in 8.0** — deliberately absent from Prisma 8.
- `—` **n/a** — feature does not apply to that database.

Each row names exactly one capability. Where an operator/command/stage set was previously bundled, it has been split so every distinct feature carries its own per-database verdict and its own evidence.

---

## Categories

| Category | Feature rows |
| --- | --- |
| [Targets & connection](scorecard/01-targets-and-connection.md) | 14 |
| [Types & values](scorecard/02-types-and-values.md) | 15 |
| [PSL schema language](scorecard/03-psl-schema-language.md) | 44 |
| [Contract emission & authoring](scorecard/04-contract-emission-and-authoring.md) | 14 |
| [SQL query builder](scorecard/05-sql-query-builder.md) | 46 |
| [SQL ORM client](scorecard/06-sql-orm-client.md) | 52 |
| [MongoDB query & ORM](scorecard/07-mongodb-query-and-orm.md) | 81 |
| [Relations](scorecard/08-relations.md) | 20 |
| [Filtering](scorecard/09-filtering.md) | 24 |
| [Ordering & pagination](scorecard/10-ordering-and-pagination.md) | 11 |
| [Aggregation & grouping](scorecard/11-aggregation-and-grouping.md) | 20 |
| [Nested writes & atomic ops](scorecard/12-nested-writes-and-atomic-ops.md) | 25 |
| [Raw & typed SQL](scorecard/13-raw-and-typed-sql.md) | 9 |
| [Transactions](scorecard/14-transactions.md) | 9 |
| [Migrations](scorecard/15-migrations.md) | 123 |
| [Introspection (`contract infer`)](scorecard/16-introspection.md) | 26 |
| [CLI commands](scorecard/17-cli-commands.md) | 32 |
| [Extensions](scorecard/18-extensions.md) | 15 |
| [Observability & lifecycle](scorecard/19-observability-and-lifecycle.md) | 13 |

The Migrations file gathers all twelve `Migrations — *` sub-topics (workflow; columns & types; IDs, PKs & autoincrement; foreign keys; indexes & unique; enums; defaults; native types; extensions; views; existing-data safety; schema filters) as sub-headings within a single file.

---

## Coverage summary

Group structure (30 groups): Targets & connection; Types & values; PSL schema language; Contract emission & authoring; SQL query builder; SQL ORM client; MongoDB query & ORM; Relations; Filtering; Ordering & pagination; Aggregation & grouping; Nested writes & atomic ops; Raw & typed SQL; Transactions; Migrations — workflow; Migrations — columns & types; Migrations — IDs, PKs & autoincrement; Migrations — foreign keys; Migrations — indexes & unique; Migrations — enums; Migrations — defaults; Migrations — native types; Migrations — extensions; Migrations — views; Migrations — existing-data safety; Migrations — schema filters; Introspection (`contract infer`); CLI commands; Extensions; Observability & lifecycle.

Verdicts are computed per feature row across the three DB columns; the tallies below count individual non-`—` cells.

Across 593 atomic feature rows (one capability each), spanning 1,779 per-database cells (593 rows × 3 databases): `✅` 416, `🟡` 488, `🧪` 12, `❌` 244 (and 619 `—` n/a cells).

Per-database tallies:

| Database | ✅ | 🟡 | 🧪 | ❌ | — |
| --- | --- | --- | --- | --- | --- |
| Postgres | 222 | 136 | 4 | 111 | 120 |
| SQLite | 85 | 235 | 4 | 98 | 171 |
| MongoDB | 109 | 117 | 4 | 35 | 328 |
