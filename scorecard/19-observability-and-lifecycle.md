# Observability & lifecycle

[← Feature-support matrix index](../scorecard.md)

Legend:

- `✅` **Works** — proven by a Prisma 8 **integration** test (one that executes the feature against a database — Postgres via PGlite, SQLite via its real driver, or MongoDB via mongodb-memory-server — and asserts the observable runtime result). Unit-tier tests (SQL/AST/plan/type/snapshot assertions, or any test that never hits a database) do not qualify. Per-database rigor applies: a Postgres integration test cannot justify a SQLite or MongoDB `✅`, and vice versa.
- `🟡` **Untested** — reachable through the Prisma 8 public surface, but no proving Prisma 8 integration test exists yet (evidence left blank). This includes features whose only backing is a unit-tier test.
- `🧪` **Experimental** — shipped in Prisma 8 but outside the stability promise (polymorphism / multi-table inheritance).
- `❌` **Not in 8.0** — deliberately absent from Prisma 8.
- `—` **n/a** — feature does not apply to that database.

| Feature | Postgres | SQLite | MongoDB | Prisma 8 evidence |
| --- | --- | --- | --- | --- |
| Runtime middleware chain | ✅ | 🟡 | 🟡 | `test/integration/test/rewriting-middleware.integration.test.ts` |
| Runtime extension descriptors (`extensions`) | ✅ | 🟡 | 🟡 | `test/integration/test/sql-orm-client/extension-operations.test.ts` |
| Execution abort / cancellation (`signal`) | ✅ | — | ✅ | `test/integration/test/sql-builder/execution-abort.test.ts`; `test/integration/test/mongo/execution-abort.test.ts` |
| Structured error envelope (`RUNTIME.*` / `PN-*`) | ✅ | 🟡 | ✅ | `test/integration/test/cli.db-verify.e2e.test.ts`; `test/integration/test/mongo/db-verify-sign.test.ts` (`PN-RUN-3001`/`PN-RUN-3002`) |
| Telemetry events | 🟡 | 🟡 | 🟡 | |
| Plan fingerprints | 🟡 | 🟡 | 🟡 | |
| OpenTelemetry tracing spans | ❌ | ❌ | ❌ | |
| Prisma P-code error taxonomy (`P2002`/`P2025`/…) | ❌ | ❌ | ❌ | |
| `$on('query')` events | ❌ | ❌ | ❌ | |
| `$on('info')` events | ❌ | ❌ | ❌ | |
| `$on('error')` events | ❌ | ❌ | ❌ | |
| Batch-key chunking (large `in` lists) | ❌ | ❌ | ❌ | |
| "Too many client instances" dev warning | ❌ | ❌ | ❌ | |
