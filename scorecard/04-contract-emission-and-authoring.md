# Contract emission & authoring

[← Feature-support matrix index](../scorecard.md)

Legend:

- `✅` **Works** — proven by a Prisma 8 **integration** test (one that executes the feature against a database — Postgres via PGlite, SQLite via its real driver, or MongoDB via mongodb-memory-server — and asserts the observable runtime result). Unit-tier tests (SQL/AST/plan/type/snapshot assertions, or any test that never hits a database) do not qualify. Per-database rigor applies: a Postgres integration test cannot justify a SQLite or MongoDB `✅`, and vice versa.
- `🟡` **Untested** — reachable through the Prisma 8 public surface, but no proving Prisma 8 integration test exists yet (evidence left blank). This includes features whose only backing is a unit-tier test.
- `🧪` **Experimental** — shipped in Prisma 8 but outside the stability promise (polymorphism / multi-table inheritance).
- `❌` **Not in 8.0** — deliberately absent from Prisma 8.
- `—` **n/a** — feature does not apply to that database.

| Feature | Postgres | SQLite | MongoDB | Prisma 8 evidence |
| --- | --- | --- | --- | --- |
| `defineContract` (TS builder) | 🟡 | 🟡 | 🟡 | |
| `field` (TS builder) | 🟡 | 🟡 | 🟡 | |
| `model` (TS builder) | 🟡 | 🟡 | 🟡 | |
| `rel` (TS builder) | 🟡 | 🟡 | 🟡 | |
| `enumType` (enum authoring) | 🟡 | 🟡 | 🟡 | |
| `member` (enum authoring) | 🟡 | 🟡 | 🟡 | |
| Postgres enum-array constraint emission | ❌ | — | — | `test/integration/test/ports/prisma/functional/enum-array/enum-array.test.ts` |
| `valueObject` (embedded type authoring) | 🟡 | 🟡 | ✅ | `test/integration/test/value-objects/value-objects.integration.test.ts` |
| `index(...)` authoring | 🟡 | 🟡 | ✅ | `test/integration/test/mongo/migration-psl-authoring.test.ts` |
| Generated Postgres index names respect identifier length limits | ❌ | — | — | `test/integration/test/ports/prisma/functional/relation-mode-gh-m-to-n/emit-map.test.ts` |
| Contract emit (`contract.json` + `contract.d.ts`) | ✅ | 🟡 | 🟡 | `test/e2e/framework/test/runtime.basic.test.ts` (`emits contract and verifies it matches on-disk artifacts`, then runs the emitted contract against PGlite) |
| PSL parse (green/red tree, typed AST) | 🟡 | 🟡 | 🟡 | |
| Callback-mode TS authoring terseness | 🟡 | 🟡 | 🟡 | |
| Cross-family PSL/TS authoring parity | 🟡 | 🟡 | ✅ | `test/integration/test/scalar-lists/psl-list-mongo-parity.integration.test.ts`; `test/integration/test/value-objects/value-objects.integration.test.ts` (`cross-family consistency`) |
