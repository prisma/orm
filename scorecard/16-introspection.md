# Introspection (`contract infer`)

[← Feature-support matrix index](../scorecard.md)

Legend:

- `✅` **Works** — proven by a Prisma 8 **integration** test (one that executes the feature against a database — Postgres via PGlite, SQLite via its real driver, or MongoDB via mongodb-memory-server — and asserts the observable runtime result). Unit-tier tests (SQL/AST/plan/type/snapshot assertions, or any test that never hits a database) do not qualify. Per-database rigor applies: a Postgres integration test cannot justify a SQLite or MongoDB `✅`, and vice versa.
- `🟡` **Untested** — reachable through the Prisma 8 public surface, but no proving Prisma 8 integration test exists yet (evidence left blank). This includes features whose only backing is a unit-tier test.
- `🧪` **Experimental** — shipped in Prisma 8 but outside the stability promise (polymorphism / multi-table inheritance).
- `❌` **Not in 8.0** — deliberately absent from Prisma 8.
- `—` **n/a** — feature does not apply to that database.

| Feature | Postgres | SQLite | MongoDB | Prisma 8 evidence |
| --- | --- | --- | --- | --- |
| Table inference | ✅ | ✅ | ✅ | `test/integration/test/family.introspect.test.ts`; `packages/3-targets/6-adapters/sqlite/test/migrations/planner-introspection.integration.test.ts`; `test/integration/test/mongo/db-schema.test.ts` (`introspects live schema`) |
| Column inference | ✅ | ✅ | ✅ | `test/integration/test/family.introspect.test.ts`; `packages/3-targets/6-adapters/sqlite/test/migrations/planner-introspection.integration.test.ts`; `test/integration/test/mongo/db-schema.test.ts` |
| Primary-key inference | ✅ | ✅ | ✅ | `test/integration/test/family.introspect.test.ts`; `packages/3-targets/6-adapters/sqlite/test/migrations/planner-introspection.integration.test.ts`; `test/integration/test/mongo/db-schema.test.ts` |
| `contract infer` CLI (PSL snapshot output) | ✅ | 🟡 | 🟡 | `test/integration/test/cli.db-introspect.e2e.test.ts` (`contract infer › writes a full PSL snapshot`) |
| Relation inference | ✅ | 🟡 | — | `test/integration/test/family.introspect.test.ts` (`post table with foreign key`) |
| FK inference | ✅ | 🟡 | — | `test/integration/test/referential-actions.integration.test.ts` (`introspection`) |
| Referential-action inference | ✅ | 🟡 | — | `test/integration/test/referential-actions.integration.test.ts` (`introspects ON DELETE CASCADE and ON UPDATE RESTRICT`) |
| Native enum inference | ✅ | — | — | `packages/3-targets/6-adapters/postgres/test/migrations/native-enum-introspection.integration.test.ts` |
| Native enum array inference | ✅ | — | — | `packages/3-targets/6-adapters/postgres/test/migrations/native-enum-introspection.integration.test.ts` |
| Native-type column inference | ✅ | — | — | `packages/3-targets/6-adapters/postgres/test/migrations/index-introspection.integration.test.ts` |
| Array column inference | ✅ | — | — | `packages/3-targets/6-adapters/postgres/test/migrations/array-column-introspection.integration.test.ts` |
| Scalar-list column inference | ✅ | — | 🟡 | `test/integration/test/scalar-lists/psl-list-roundtrip.integration.test.ts`; `test/integration/test/scalar-lists/orm-list-read.integration.test.ts` |
| RLS introspection | ✅ | — | — | `packages/3-targets/6-adapters/postgres/test/migrations/rls-introspection.integration.test.ts` |
| Mongo scalar type inference (`String`, `Int`, `Double`, `Date`, `ObjectId`) | — | — | ✅ | `test/integration/test/mongo/db-schema.test.ts` |
| Mongo index inference | — | — | ✅ | `test/integration/test/mongo/db-schema.test.ts` (`unique index` on email) |
| Mongo validator inference | — | — | ✅ | `test/integration/test/mongo/db-schema.test.ts` (`includes validators` — `strict`) |
| Mongo collection-options inference | — | — | ✅ | `test/integration/test/mongo/db-schema.test.ts` (`collection options` — `capped`) |
| Re-introspection merge (keep hand edits / `@@map`) | ❌ | ❌ | ❌ | |
| View introspection | ❌ | ❌ | ❌ | |
| Descending-index ordering fidelity | ❌ | ❌ | ❌ | |
| Index operator-class introspection | ❌ | — | — | |
| Exclusion / check-constraint introspection | ❌ | — | — | |
| Implicit m:n inference from join tables | ❌ | ❌ | — | |
| Mongo `BigInt`/`Decimal`/`Bytes` inference | — | — | ❌ | |
| Mongo `--composite-type-depth` control | — | — | ❌ | |
| Multi-schema `schemas` error codes (P4001/P1012) | ❌ | — | — | |
