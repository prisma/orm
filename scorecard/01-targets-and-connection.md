# Targets & connection

[← Feature-support matrix index](../scorecard.md)

Legend:

- `✅` **Works** — proven by a Prisma 8 **integration** test (one that executes the feature against a database — Postgres via PGlite, SQLite via its real driver, or MongoDB via mongodb-memory-server — and asserts the observable runtime result). Unit-tier tests (SQL/AST/plan/type/snapshot assertions, or any test that never hits a database) do not qualify. Per-database rigor applies: a Postgres integration test cannot justify a SQLite or MongoDB `✅`, and vice versa.
- `🟡` **Untested** — reachable through the Prisma 8 public surface, but no proving Prisma 8 integration test exists yet (evidence left blank). This includes features whose only backing is a unit-tier test.
- `🧪` **Experimental** — shipped in Prisma 8 but outside the stability promise (polymorphism / multi-table inheritance).
- `❌` **Not in 8.0** — deliberately absent from Prisma 8.
- `—` **n/a** — feature does not apply to that database.

| Feature | Postgres | SQLite | MongoDB | Prisma 8 evidence |
| --- | --- | --- | --- | --- |
| Postgres runtime client (`postgres()`) | ✅ | — | — | `test/e2e/framework/test/runtime.basic.test.ts` (`end-to-end basic queries`) |
| SQLite runtime client (`sqlite()`) | — | ✅ | — | `test/e2e/framework/test/sqlite/orm.test.ts` (`e2e: ORM on SQLite`) |
| Mongo runtime client (`mongo()`) | — | — | ✅ | `test/integration/test/mongo/orm.test.ts` (`full flow: ORM -> typed AST -> runtime -> driver -> typed results`) |
| Driver binding / connect (url, pool/client, uri/mongoClient) | ✅ | ✅ | ✅ | `test/e2e/framework/test/runtime.basic.test.ts`; `test/e2e/framework/test/sqlite/orm.test.ts`; `test/integration/test/mongo/orm.test.ts` |
| Multi-namespace (schema-qualified) runtime | ✅ | 🟡 | — | `test/e2e/framework/test/multi-namespace-runtime.test.ts` (`applies auth + public schemas and queries each namespace`) |
| `verifyMarker` guardrail | ✅ | ✅ | ✅ | `test/integration/test/runtime.verify-marker.missing-table.integration.test.ts`; `test/e2e/framework/test/sqlite/runtime.verify-marker.missing-table.test.ts`; `test/integration/test/mongo/db-verify-sign.test.ts` |
| `enums` runtime accessor | ✅ | 🟡 | 🟡 | `packages/3-targets/6-adapters/postgres/test/migrations/order-by-enum.integration.test.ts` |
| `nativeEnums` runtime accessor (Postgres native enums) | ✅ | — | — | `packages/3-targets/6-adapters/postgres/test/migrations/order-by-enum.integration.test.ts` |
| Mongo strict/permissive binding mode | — | — | 🟡 | |
| Static (no-driver) `sql` authoring surface (`postgresStatic`/`sqliteStatic`/`mongoStatic`, no execute) | 🟡 | 🟡 | 🟡 | |
| Static (no-driver) `raw` authoring surface (`postgresStatic`/`sqliteStatic`/`mongoStatic`, no execute) | 🟡 | 🟡 | 🟡 | |
| Static (no-driver) `enums` accessor (`postgresStatic`/`sqliteStatic`/`mongoStatic`, no execute) | 🟡 | 🟡 | 🟡 | |
| Serverless Postgres client (cursor pagination) | 🟡 | — | — | |
| `close()` / `Symbol.asyncDispose` | 🟡 | 🟡 | 🟡 | |
