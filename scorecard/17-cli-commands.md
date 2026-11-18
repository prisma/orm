# CLI commands

[← Feature-support matrix index](../scorecard.md)

Legend:

- `✅` **Works** — proven by a Prisma 8 **integration** test (one that executes the feature against a database — Postgres via PGlite, SQLite via its real driver, or MongoDB via mongodb-memory-server — and asserts the observable runtime result). Unit-tier tests (SQL/AST/plan/type/snapshot assertions, or any test that never hits a database) do not qualify. Per-database rigor applies: a Postgres integration test cannot justify a SQLite or MongoDB `✅`, and vice versa.
- `🟡` **Untested** — reachable through the Prisma 8 public surface, but no proving Prisma 8 integration test exists yet (evidence left blank). This includes features whose only backing is a unit-tier test.
- `🧪` **Experimental** — shipped in Prisma 8 but outside the stability promise (polymorphism / multi-table inheritance).
- `❌` **Not in 8.0** — deliberately absent from Prisma 8.
- `—` **n/a** — feature does not apply to that database.

| Feature | Postgres | SQLite | MongoDB | Prisma 8 evidence |
| --- | --- | --- | --- | --- |
| `contract emit` | 🟡 | 🟡 | 🟡 | |
| `contract infer` | ✅ | 🟡 | 🟡 | `test/integration/test/cli.db-introspect.e2e.test.ts` |
| `db init` | ✅ | 🟡 | ✅ | `test/integration/test/cli.db-init.e2e.test.ts`; `test/integration/test/cli.control-policy.mongo.e2e.test.ts` |
| `db update` | ✅ | 🟡 | 🟡 | `test/integration/test/cli.db-update.e2e.test.ts` |
| `db verify` | ✅ | 🟡 | ✅ | `test/integration/test/cli.db-verify.e2e.test.ts`; `test/integration/test/cli.mongo-db-verify.e2e.test.ts` |
| `db schema` | ✅ | 🟡 | ✅ | `test/integration/test/cli.db-introspect.e2e.test.ts` (`db schema`); `test/integration/test/cli.mongo-db-schema.e2e.test.ts` |
| `db sign` | ✅ | 🟡 | ✅ | `test/integration/test/cli.db-sign.e2e.test.ts`; `test/integration/test/cli.mongo-db-sign.e2e.test.ts` |
| `migration plan` | ✅ | 🟡 | 🟡 | `test/integration/test/cli.migration-plan-ref-aware.e2e.test.ts` |
| `migrate` (apply) | ✅ | ✅ | ✅ | `test/integration/test/cli.migration-apply.e2e.test.ts`; `test/e2e/framework/test/sqlite/migrations/additive.test.ts`; `test/integration/test/mongo/migration-e2e.test.ts` |
| `migration list` | 🟡 | 🟡 | 🟡 | |
| `migration log` | 🟡 | 🟡 | 🟡 | |
| `migration status` | 🟡 | 🟡 | 🟡 | |
| `migration show` | 🟡 | 🟡 | 🟡 | |
| `migration graph` | 🟡 | 🟡 | 🟡 | |
| `migration check` | 🟡 | 🟡 | 🟡 | |
| `migration new` (scaffold) | 🟡 | 🟡 | 🟡 | |
| `ref set` | ✅ | 🟡 | — | `test/integration/test/cli.db-ref-advancement.e2e.test.ts` |
| `ref delete` | 🟡 | 🟡 | — | |
| `ref list` | 🟡 | 🟡 | — | |
| `init` (project scaffold) | 🟡 | 🟡 | 🟡 | |
| `format` | 🟡 | 🟡 | 🟡 | |
| `lsp` (language server) | 🟡 | 🟡 | 🟡 | |
| `telemetry` (consent / opt-out) | 🟡 | 🟡 | 🟡 | |
| `prisma version` | ❌ | ❌ | ❌ | |
| `prisma studio` | ❌ | ❌ | ❌ | |
| `prisma debug` | ❌ | ❌ | ❌ | |
| `prisma status` | ❌ | ❌ | ❌ | |
| `db seed` | ❌ | ❌ | ❌ | |
| `db execute` | ❌ | ❌ | ❌ | |
| `migrate reset` | ❌ | ❌ | ❌ | |
| `migrate resolve` | ❌ | ❌ | ❌ | |
| `migrate diff` | ❌ | ❌ | ❌ | |
