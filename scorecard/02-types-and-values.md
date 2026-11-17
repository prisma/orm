# Types & values

[← Feature-support matrix index](../scorecard.md)

Legend:

- `✅` **Works** — proven by a Prisma 8 **integration** test (one that executes the feature against a database — Postgres via PGlite, SQLite via its real driver, or MongoDB via mongodb-memory-server — and asserts the observable runtime result). Unit-tier tests (SQL/AST/plan/type/snapshot assertions, or any test that never hits a database) do not qualify. Per-database rigor applies: a Postgres integration test cannot justify a SQLite or MongoDB `✅`, and vice versa.
- `🟡` **Untested** — reachable through the Prisma 8 public surface, but no proving Prisma 8 integration test exists yet (evidence left blank). This includes features whose only backing is a unit-tier test.
- `🧪` **Experimental** — shipped in Prisma 8 but outside the stability promise (polymorphism / multi-table inheritance).
- `❌` **Not in 8.0** — deliberately absent from Prisma 8.
- `—` **n/a** — feature does not apply to that database.

| Feature | Postgres | SQLite | MongoDB | Prisma 8 evidence |
| --- | --- | --- | --- | --- |
| `String` scalar | ✅ | ✅ | ✅ | `test/e2e/framework/test/dml.test.ts` (`applies literal defaults for every supported type`); `test/e2e/framework/test/sqlite/sql-builder.test.ts`; `test/integration/test/mongo/orm.test.ts` |
| `Int` scalar | ✅ | ✅ | ✅ | `test/e2e/framework/test/dml.test.ts`; `test/e2e/framework/test/sqlite/sql-builder.test.ts` (`integer survives insert and select`); `test/integration/test/mongo/query-builder.test.ts` |
| `Float` scalar | ✅ | 🟡 | ✅ | `test/e2e/framework/test/dml.test.ts` (`rating`); `test/integration/test/mongo/query-builder.test.ts` (`groups by category and sums prices`) |
| `Boolean` scalar | ✅ | 🟡 | 🟡 | `test/e2e/framework/test/dml.test.ts` (`active`) |
| `BigInt` scalar (64-bit; Postgres surfaced as string) | ✅ | 🟡 | — | `test/e2e/framework/test/dml.test.ts` (`big_count`) |
| `Decimal` scalar (maps to string / text) | ✅ | 🟡 | — | `test/integration/test/scalar-lists/psl-list-roundtrip.integration.test.ts` (`DateTime[]/Bytes[]/Decimal[] … round-trip element values`) |
| `DateTime` scalar | 🟡 | ✅ | 🟡 | `test/e2e/framework/test/sqlite/sql-builder.test.ts` (`datetime survives insert and select`) |
| `Json` scalar (jsonb / json) | ✅ | ✅ | — | `test/e2e/framework/test/dml.test.ts` (`supports typed jsonb/json values`); `test/e2e/framework/test/sqlite/sql-builder.test.ts` (`json survives insert and select`) |
| `Uint8Array` values nested in `Json` serialize as base64 | ❌ | 🟡 | — | `test/integration/test/ports/prisma/functional/issues-29267-uint8array-in-json/issues-29267-uint8array-in-json.test.ts` |
| `Bytes` scalar | 🟡 | 🟡 | — | |
| `ObjectId` scalar (Mongo `_id`) | — | — | ✅ | `test/integration/test/mongo/orm.test.ts` |
| Scalar-list columns (`String[]`, `Int[]`, …) | ✅ | — | ✅ | `test/integration/test/scalar-lists/orm-list-read.integration.test.ts`; `test/integration/test/scalar-lists/psl-list-mongo-parity.integration.test.ts` |
| Value-object / composite (`type` block) round-trip | ✅ | 🟡 | ✅ | `test/integration/test/value-objects/value-objects.e2e.test.ts`; `test/integration/test/mongo/orm.test.ts` (`embedded documents appear in default results`) |
| `Prisma.Decimal` precision-safe value object | ❌ | ❌ | — | |
| Int-overflow → clean error | ❌ | ❌ | — | |
