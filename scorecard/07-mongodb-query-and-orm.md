# MongoDB query & ORM

[← Feature-support matrix index](../scorecard.md)

Legend:

- `✅` **Works** — proven by a Prisma Next **integration** test (one that executes the feature against a database — Postgres via PGlite, SQLite via its real driver, or MongoDB via mongodb-memory-server — and asserts the observable runtime result). Unit-tier tests (SQL/AST/plan/type/snapshot assertions, or any test that never hits a database) do not qualify. Per-database rigor applies: a Postgres integration test cannot justify a SQLite or MongoDB `✅`, and vice versa.
- `🟡` **Untested** — reachable through the Prisma Next public surface, but no proving Prisma Next integration test exists yet (evidence left blank). This includes features whose only backing is a unit-tier test.
- `🧪` **Experimental** — shipped in Prisma Next but outside the stability promise (polymorphism / multi-table inheritance).
- `❌` **Not in 8.0** — deliberately absent from Prisma Next.
- `—` **n/a** — feature does not apply to that database.

| Feature | Postgres | SQLite | MongoDB | Prisma Next evidence |
| --- | --- | --- | --- | --- |
| ORM `where` filter | — | — | ✅ | `test/integration/test/mongo/orm.test.ts` (`where() with filter expression narrows results`) |
| ORM `select` projection | — | — | ✅ | `test/integration/test/mongo/orm.test.ts` (`select() restricts returned fields`) |
| ORM `orderBy` | — | — | ✅ | `test/integration/test/mongo/orm.test.ts` (`orderBy() returns results in specified order`) |
| ORM `limit` | — | — | ✅ | `test/integration/test/mongo/orm.test.ts` (`offset() and limit() return correct subset`) |
| ORM `offset` | — | — | ✅ | `test/integration/test/mongo/orm.test.ts` (`offset() and limit() return correct subset`) |
| ORM `all()` | — | — | ✅ | `test/integration/test/mongo/orm.test.ts` (`all() on a non-polymorphic root`) |
| ORM `first()` | — | — | 🟡 | |
| ORM `include` (reference relation via `$lookup`) | — | — | ✅ | `test/integration/test/mongo/orm.test.ts` (`include() on a reference relation returns related docs via $lookup`) |
| Embedded documents in default results | — | — | ✅ | `test/integration/test/mongo/orm.test.ts` (`embedded documents appear in default results without include`) |
| Where filter operator `$eq` | — | — | ✅ | `test/integration/test/mongo/orm.test.ts` (`where() with filter expression narrows results`) |
| Where filter operator `$ne` | — | — | 🟡 | |
| Where filter operator `$gt` | — | — | 🟡 | |
| Where filter operator `$gte` | — | — | 🟡 | |
| Where filter operator `$lt` | — | — | 🟡 | |
| Where filter operator `$lte` | — | — | 🟡 | |
| Where filter operator `$in` | — | — | 🟡 | |
| Where filter operator `$nin` | — | — | 🟡 | |
| Where filter operator `$size` | — | — | 🟡 | |
| `$expr` cross-field / computed filter | — | — | ✅ | `test/integration/test/mongo/expr-filter.test.ts` |
| ORM `create` | — | — | 🟡 | |
| ORM `createAll` | — | — | 🟡 | |
| ORM `createAndCount` | — | — | 🟡 | |
| ORM `update` | — | — | 🟡 | |
| ORM `updateAll` | — | — | 🟡 | |
| ORM `updateAndCount` | — | — | 🟡 | Shipped count terminal; Mongo runtime maps `modifiedCount` to `affectedRows`; integration evidence pending |
| ORM `delete` | — | — | 🟡 | |
| ORM `deleteAll` | — | — | 🟡 | |
| ORM `deleteAndCount` | — | — | 🟡 | Shipped count terminal; Mongo runtime maps `deletedCount` to `affectedRows`; integration evidence pending |
| ORM `upsert` | — | — | 🟡 | |
| Rejection of `null` writes to required composites | — | — | ✅ | `test/integration/test/ports/prisma/functional/composites-object-create/composites-object-create.test.ts`; corresponding object/list createMany, update, updateMany, and upsert port suites |
| Update operator `set` | — | — | 🟡 | |
| Update operator `unset` | — | — | 🟡 | |
| Update operator `push` | — | — | 🟡 | |
| Update operator `pull` | — | — | 🟡 | |
| Update operator `addToSet` | — | — | 🟡 | |
| Update operator `pop` | — | — | 🟡 | |
| Update operator `inc` | — | — | 🟡 | |
| Update operator `mul` | — | — | 🟡 | |
| Value-object dot-path filtering | — | — | 🟡 | |
| Pipeline stage `match` | — | — | ✅ | `test/integration/test/mongo/query-builder.test.ts` (`match + sort + limit + skip`) |
| Pipeline stage `sort` | — | — | ✅ | `test/integration/test/mongo/query-builder.test.ts` (`match + sort + limit + skip`) |
| Pipeline stage `limit` | — | — | ✅ | `test/integration/test/mongo/query-builder.test.ts` (`filters, sorts, and paginates`) |
| Pipeline stage `skip` | — | — | ✅ | `test/integration/test/mongo/query-builder.test.ts` (`skips documents`) |
| Pipeline stage `sample` | — | — | ✅ | `test/integration/test/mongo/query-builder.test.ts` (`returns requested number of random documents`) |
| Pipeline stage `addFields` | — | — | ✅ | `test/integration/test/mongo/query-builder.test.ts` (`adds computed fields to documents`) |
| Pipeline stage `lookup` | — | — | ✅ | `test/integration/test/mongo/query-builder.test.ts` (`joins orders with products by name`) |
| Pipeline stage `project` | — | — | ✅ | `test/integration/test/mongo/query-builder.test.ts` (`includes only specified fields`) |
| Pipeline stage `unwind` | — | — | ✅ | `test/integration/test/mongo/query-builder.test.ts` (`flattens array field into separate documents`) |
| Pipeline stage `group` | — | — | ✅ | `test/integration/test/mongo/query-builder.test.ts` (`groups by category and sums prices`) |
| Pipeline stage `replaceRoot` | — | — | 🟡 | |
| Pipeline stage `count` | — | — | ✅ | `test/integration/test/mongo/query-builder.test.ts` (`counts matching documents`) |
| Pipeline stage `sortByCount` | — | — | ✅ | `test/integration/test/mongo/query-builder.test.ts` (`counts and sorts by category frequency`) |
| Pipeline stage `redact` | — | — | ✅ | `test/integration/test/mongo/query-builder.test.ts` (`prunes documents not matching condition`) |
| Pipeline stage `out` | — | — | ✅ | `test/integration/test/mongo/query-builder.test.ts` (`writes pipeline results to a new collection`) |
| Pipeline stage `merge` | — | — | ✅ | `test/integration/test/mongo/query-builder.test.ts` (`merges pipeline results into target collection`) |
| Pipeline stage `unionWith` | — | — | ✅ | `test/integration/test/mongo/query-builder.test.ts` (`combines documents from two collections`) |
| Pipeline stage `bucket` | — | — | ✅ | `test/integration/test/mongo/query-builder.test.ts` (`groups documents into price ranges`) |
| Pipeline stage `bucketAuto` | — | — | ✅ | `test/integration/test/mongo/query-builder.test.ts` (`distributes documents into equal-sized buckets`) |
| Pipeline stage `geoNear` | — | — | 🟡 | |
| Pipeline stage `facet` | — | — | ✅ | `test/integration/test/mongo/query-builder.test.ts` (`runs multiple sub-pipelines in parallel`) |
| Pipeline stage `graphLookup` | — | — | ✅ | `test/integration/test/mongo/query-builder.test.ts` (`self-joins orders by productName`) |
| Pipeline stage `setWindowFields` | — | — | ✅ | `test/integration/test/mongo/query-builder.test.ts` (`computes running total over sorted documents`) |
| Pipeline stage `densify` | — | — | 🟡 | |
| Pipeline stage `fill` | — | — | 🟡 | |
| Pipeline stage `search` (Atlas) | — | — | 🟡 | |
| Pipeline stage `searchMeta` (Atlas) | — | — | 🟡 | |
| Pipeline stage `vectorSearch` (Atlas) | — | — | 🟡 | |
| Accumulator `sum` | — | — | ✅ | `test/integration/test/mongo/query-builder.test.ts` (`groups by category and sums prices`) |
| Accumulator `avg` | — | — | 🟡 | |
| Accumulator `min` | — | — | ✅ | `test/integration/test/mongo/query-builder.test.ts` (`whole-collection grouping with _id: null`) |
| Accumulator `max` | — | — | ✅ | `test/integration/test/mongo/query-builder.test.ts` (`whole-collection grouping with _id: null`) |
| Accumulator `first` | — | — | 🟡 | |
| Accumulator `last` | — | — | 🟡 | |
| Accumulator `push` | — | — | 🟡 | |
| Accumulator `addToSet` | — | — | 🟡 | |
| Accumulator `count` | — | — | ✅ | `test/integration/test/mongo/query-builder.test.ts` (`groups by category and sums prices` — `acc.count()`) |
| Accumulator `firstN` | — | — | ✅ | `test/integration/test/mongo/query-builder.test.ts` (`acc.firstN returns first N items per group`) |
| Raw Mongo client (`mongoRaw`) | — | — | 🟡 | |
| Composite `is` filter | — | — | ❌ | |
| Composite `isSet` filter | — | — | ❌ | |
| Composite `orderBy _count` | — | — | ❌ | |

Mongo count terminals are shipped, but remain 🟡 under this scorecard's integration-test legend until a qualifying MongoDB ORM integration test asserts them. The runtime and target-driver evidence is in `packages/2-mongo-family/7-runtime/test/mongo-middleware.test.ts` (statistics mapping and interception) and `packages/3-mongo-target/3-mongo-driver/test/mongo-driver.test.ts` (`modifiedCount` and `deletedCount`). Mongo update counts mean `modifiedCount`, not matched rows, so no-op updates return zero; deletes mean `deletedCount`.
