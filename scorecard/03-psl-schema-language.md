# PSL schema language

[← Feature-support matrix index](../scorecard.md)

Legend:

- `✅` **Works** — proven by a Prisma 8 **integration** test (one that executes the feature against a database — Postgres via PGlite, SQLite via its real driver, or MongoDB via mongodb-memory-server — and asserts the observable runtime result). Unit-tier tests (SQL/AST/plan/type/snapshot assertions, or any test that never hits a database) do not qualify. Per-database rigor applies: a Postgres integration test cannot justify a SQLite or MongoDB `✅`, and vice versa.
- `🟡` **Untested** — reachable through the Prisma 8 public surface, but no proving Prisma 8 integration test exists yet (evidence left blank). This includes features whose only backing is a unit-tier test.
- `🧪` **Experimental** — shipped in Prisma 8 but outside the stability promise (polymorphism / multi-table inheritance).
- `❌` **Not in 8.0** — deliberately absent from Prisma 8.
- `—` **n/a** — feature does not apply to that database.

| Feature | Postgres | SQLite | MongoDB | Prisma 8 evidence |
| --- | --- | --- | --- | --- |
| `model` block | 🟡 | 🟡 | ✅ | `test/integration/test/mongo/migration-psl-authoring.test.ts` |
| `enum` block | 🟡 | 🟡 | 🟡 | |
| `type` (`@@type`) composite block | 🟡 | 🟡 | ✅ | `test/integration/test/value-objects/value-objects.integration.test.ts` (embedded value-object round-trip against Mongo) |
| `@id` (field-level primary key) | 🟡 | ✅ | ✅ | `test/e2e/framework/test/sqlite/migrations/additive.test.ts` (`single table with PK`); `test/integration/test/mongo/migration-psl-authoring.test.ts` |
| `@@id` (composite primary key) | 🟡 | 🟡 | 🟡 | |
| `@unique` (field-level unique) | ✅ | ✅ | ✅ | `packages/3-targets/6-adapters/postgres/test/migrations/enum-check-constraint.integration.test.ts`; `test/e2e/framework/test/sqlite/migrations/additive.test.ts` (`unique constraints`); `test/integration/test/mongo/migration-psl-authoring.test.ts` (`@unique … single-field unique index`) |
| `@@unique` (model-level composite unique) | 🟡 | ✅ | ✅ | `test/e2e/framework/test/sqlite/migrations/additive.test.ts` (`unique constraints`); `test/integration/test/mongo/migration-psl-authoring.test.ts` (`@@unique([name])`) |
| `@@index([...], type?, options?)` | ✅ | ✅ | ✅ | `packages/3-targets/6-adapters/postgres/test/migrations/index-introspection.integration.test.ts`; `test/e2e/framework/test/sqlite/migrations/additive.test.ts` (`indexes`); `test/integration/test/mongo/migration-psl-authoring.test.ts` (`@@index produces indexes`) |
| `@map` (field rename) | 🟡 | 🟡 | ✅ | `test/integration/test/mongo/migration-psl-authoring.test.ts` (`@map respects mapped names`) |
| `@@map` (model rename) | 🟡 | 🟡 | 🟡 | |
| `@relation(...)` wiring | ✅ | ✅ | ✅ | `test/integration/test/referential-actions.integration.test.ts`; `test/e2e/framework/test/sqlite/migrations/additive.test.ts` (FK tables); `test/integration/test/mongo/orm.test.ts` (`include() on a reference relation`) |
| `@@discriminator` (STI/MTI discriminator) | 🧪 | 🧪 | 🧪 | `test/integration/test/sql-orm-client/polymorphism.test.ts`; `test/integration/test/mongo/orm.test.ts` (`discriminator narrows variant types`) |
| `@@base` (STI/MTI base) | 🧪 | 🧪 | 🧪 | `test/integration/test/sql-orm-client/polymorphism.test.ts` |
| `@@control(policy)` ownership | ✅ | 🟡 | ✅ | `test/integration/test/cli.control-policy.postgres.e2e.test.ts`; `test/integration/test/cli.control-policy.mongo.e2e.test.ts` |
| `@@textIndex` (Mongo full-text) | — | — | ✅ | `test/integration/test/mongo/migration-psl-authoring.test.ts` (`@@textIndex produces text index`) |
| Mongo `hashed` index qualifier | — | — | ✅ | `test/integration/test/mongo/migration-psl-authoring.test.ts` (`type: "hashed" produces hashed index`) |
| Mongo `2dsphere` index qualifier | — | — | ✅ | `test/integration/test/mongo/migration-psl-authoring.test.ts` (`type: "2dsphere" produces 2dsphere index`) |
| Mongo `2d` index qualifier | — | — | 🟡 | |
| Mongo `wildcard()` index qualifier | — | — | ✅ | `test/integration/test/mongo/migration-psl-authoring.test.ts` (`wildcard() produces wildcard index`) |
| RLS `role` block | ✅ | — | — | `test/integration/test/rls-ts-walking-skeleton.integration.test.ts` |
| RLS `rls` block | ✅ | — | — | `test/integration/test/rls-ts-walking-skeleton.integration.test.ts` |
| RLS `policy` block | ✅ | — | — | `test/integration/test/rls-ts-walking-skeleton.integration.test.ts` |
| Native `@db.*` types (SQLite: mapped via type affinity) | ✅ | 🟡 | — | `packages/3-targets/6-adapters/postgres/test/migrations/native-array-columns.integration.test.ts` |
| `@default(autoincrement())` | 🟡 | ✅ | — | `test/e2e/framework/test/sqlite/migrations/additive.test.ts` (`INTEGER PRIMARY KEY`) |
| `@default(now())` | 🟡 | ✅ | — | `test/e2e/framework/test/sqlite/migrations/widening.test.ts` (`round-trips a now() default`) |
| `@default(uuid())` | ✅ | 🟡 | — | `packages/3-targets/6-adapters/postgres/test/migrations/planner.uuid.integration.test.ts` |
| `@default(uuid(7))` | ✅ | 🟡 | — | `test/e2e/framework/test/dml.test.ts` (`UUIDv7 client-generated IDs`) |
| `@default(cuid(2))` | 🟡 | 🟡 | — | |
| `@default(ulid())` | 🟡 | 🟡 | — | |
| `@default(nanoid())` | 🟡 | 🟡 | — | |
| `@default(dbgenerated("..."))` | 🟡 | 🟡 | — | |
| TS ID generator `ulid` | 🟡 | 🟡 | — | |
| TS ID generator `nanoid` | 🟡 | 🟡 | — | |
| TS ID generator `uuidv7` | ✅ | 🟡 | — | `test/e2e/framework/test/dml.test.ts` (`auto-generates a valid UUIDv7 id on insert`) |
| TS ID generator `uuidv4` | 🟡 | 🟡 | — | |
| TS ID generator `cuid2` | 🟡 | 🟡 | — | |
| TS ID generator `ksuid` | 🟡 | 🟡 | — | |
| Literal `@default(...)` values | ✅ | ✅ | 🟡 | `test/e2e/framework/test/dml.test.ts` (`applies literal defaults for every supported type`); `test/e2e/framework/test/sqlite/migrations/additive.test.ts` (`default values`) |
| `@default(cuid())` (cuid v1) | ❌ | ❌ | — | |
| `Unsupported("...")` | ❌ | ❌ | ❌ | |
| `@ignore` | ❌ | ❌ | ❌ | |
| `@@ignore` | ❌ | ❌ | ❌ | |
| `@shardKey` | ❌ | ❌ | ❌ | |
| `@@shardKey` | ❌ | ❌ | ❌ | |
