# Extensions

[← Feature-support matrix index](../scorecard.md)

Legend:

- `✅` **Works** — proven by a Prisma 8 **integration** test (one that executes the feature against a database — Postgres via PGlite, SQLite via its real driver, or MongoDB via mongodb-memory-server — and asserts the observable runtime result). Unit-tier tests (SQL/AST/plan/type/snapshot assertions, or any test that never hits a database) do not qualify. Per-database rigor applies: a Postgres integration test cannot justify a SQLite or MongoDB `✅`, and vice versa.
- `🟡` **Untested** — reachable through the Prisma 8 public surface, but no proving Prisma 8 integration test exists yet (evidence left blank). This includes features whose only backing is a unit-tier test.
- `🧪` **Experimental** — shipped in Prisma 8 but outside the stability promise (polymorphism / multi-table inheritance).
- `❌` **Not in 8.0** — deliberately absent from Prisma 8.
- `—` **n/a** — feature does not apply to that database.

| Feature | Postgres | SQLite | MongoDB | Prisma 8 evidence |
| --- | --- | --- | --- | --- |
| pgvector `vector(n)` column type | ✅ | — | — | `test/integration/test/extension-pgvector-scenario-a.e2e.integration.test.ts` |
| pgvector `cosineDistance` | ✅ | — | — | `test/integration/test/sql-builder/extension-functions.test.ts` (`cosineDistance computes distance for identical vectors`) |
| pgvector `cosineSimilarity` | ✅ | — | — | `test/integration/test/sql-builder/extension-functions.test.ts` (`cosineSimilarity computes similarity for identical vectors`) |
| PostGIS (`geometry` + spatial operators) | 🟡 | — | — | |
| ParadeDB (BM25 index + full-text operators) | 🟡 | — | — | |
| Supabase external `auth` contract | 🟡 | — | — | |
| Supabase external `storage` contract | 🟡 | — | — | |
| Supabase role binding | ✅ | — | — | `packages/3-extensions/supabase/test/roles-verify.integration.test.ts` |
| arktype-json (validated JSON columns) | ✅ | — | — | `test/e2e/framework/test/arktype-json.test.ts` |
| middleware-cache (caching middleware) | 🟡 | 🟡 | 🟡 | |
| Extension query-operation registration | ✅ | — | — | `test/integration/test/sql-orm-client/extension-operations.test.ts` |
| `$extends` result components | ❌ | ❌ | ❌ | |
| `$extends` client components | ❌ | ❌ | ❌ | |
| `$allModels` | ❌ | ❌ | ❌ | |
| `defineExtension` | ❌ | ❌ | ❌ | |
