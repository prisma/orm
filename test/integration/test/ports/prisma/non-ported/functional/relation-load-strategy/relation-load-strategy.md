# Non-ported — relation-load-strategy

**Recurring gap:** Prisma 8 exposes no `relationLoadStrategy` query option and no `relationJoins` preview feature. Verified by grepping `packages/` (`grep -rin "relationLoadStrategy\|loadStrategy\|relationJoins"` → zero matches; the only `strategy` hit in `sql-orm-client/src/collection.ts` is the unrelated MTI polymorphism variant) and confirming the ORM `include(relationName, refineFn?)` builder takes no options object where such a key could be passed. Upstream's `relationLoadStrategy` selects JOIN (`'join'`, LATERAL) vs correlated-subquery (`'query'`) execution per query; Prisma 8 has no equivalent per-query option.

## supported-queries.ts

Postgres in-scope (matrix = `providersSupportingRelationJoins` = [postgres, cockroachdb, mysql]); both strategy cases (`query`, `join`) apply. Each test passes `relationLoadStrategy` and asserts both the loaded relation shape AND which SQL execution strategy was used (LEFT JOIN LATERAL matcher / query count). The whole subject is the option, which Prisma 8 cannot express.

- `packages/client/tests/functional/relation-load-strategy/supported-queries.ts` › `findMany` — findMany with `relationLoadStrategy` loads nested posts→comments→author and asserts join-vs-query execution — Prisma 8 has no `relationLoadStrategy` query option.
- `packages/client/tests/functional/relation-load-strategy/supported-queries.ts` › `findFirst` — findFirst with `relationLoadStrategy` loads nested relations and asserts join-vs-query execution — Prisma 8 has no `relationLoadStrategy` query option.
- `packages/client/tests/functional/relation-load-strategy/supported-queries.ts` › `findFirstOrThrow` — findFirstOrThrow with `relationLoadStrategy` loads nested relations and asserts join-vs-query execution — Prisma 8 has no `relationLoadStrategy` query option.
- `packages/client/tests/functional/relation-load-strategy/supported-queries.ts` › `findUnique` — findUnique with `relationLoadStrategy` loads nested relations and asserts join-vs-query execution — Prisma 8 has no `relationLoadStrategy` query option.
- `packages/client/tests/functional/relation-load-strategy/supported-queries.ts` › `findUniqueOrThrow` — findUniqueOrThrow with `relationLoadStrategy` loads nested relations and asserts join-vs-query execution — Prisma 8 has no `relationLoadStrategy` query option.
- `packages/client/tests/functional/relation-load-strategy/supported-queries.ts` › `create` — create with `relationLoadStrategy` returns nested-relation selection and asserts join-vs-query execution — Prisma 8 has no `relationLoadStrategy` query option.
- `packages/client/tests/functional/relation-load-strategy/supported-queries.ts` › `update` — update with `relationLoadStrategy` returns nested-relation selection and asserts join-vs-query execution — Prisma 8 has no `relationLoadStrategy` query option.
- `packages/client/tests/functional/relation-load-strategy/supported-queries.ts` › `delete` — delete with `relationLoadStrategy` returns nested-relation selection and asserts join-vs-query execution — Prisma 8 has no `relationLoadStrategy` query option.
- `packages/client/tests/functional/relation-load-strategy/supported-queries.ts` › `upsert` — upsert with `relationLoadStrategy` returns nested-relation selection and asserts join-vs-query execution — Prisma 8 has no `relationLoadStrategy` query option.
- `packages/client/tests/functional/relation-load-strategy/supported-queries.ts` › `create with no relation selection` — create with `relationLoadStrategy` selecting only scalars asserts relation-join NOT used — Prisma 8 has no `relationLoadStrategy` query option.

## unsupported-queries.ts

Postgres in-scope (same matrix). Each test asserts that passing `relationLoadStrategy` in an unsupported position is a type error (`@ts-expect-error`) AND rejects at runtime with a Prisma "Unknown argument `relationLoadStrategy`" validation error. The argument does not exist in Prisma 8 to be rejected, so there is neither a type-error nor a runtime-throw to assert.

- `packages/client/tests/functional/relation-load-strategy/unsupported-queries.ts` › `nested subquery in findMany using include` — rejects nested `relationLoadStrategy` inside `include` (type + runtime) — Prisma 8 has no `relationLoadStrategy` query option to reject.
- `packages/client/tests/functional/relation-load-strategy/unsupported-queries.ts` › `nested subquery in findMany using select` — rejects nested `relationLoadStrategy` inside `select` (type + runtime) — Prisma 8 has no `relationLoadStrategy` query option to reject.
- `packages/client/tests/functional/relation-load-strategy/unsupported-queries.ts` › `aggregate` — rejects `relationLoadStrategy` on aggregate (type + runtime) — Prisma 8 has no `relationLoadStrategy` query option to reject.
- `packages/client/tests/functional/relation-load-strategy/unsupported-queries.ts` › `groupBy` — rejects `relationLoadStrategy` on groupBy (type + runtime) — Prisma 8 has no `relationLoadStrategy` query option to reject.
- `packages/client/tests/functional/relation-load-strategy/unsupported-queries.ts` › `createMany` — rejects `relationLoadStrategy` on createMany (type + runtime) — Prisma 8 has no `relationLoadStrategy` query option to reject.
- `packages/client/tests/functional/relation-load-strategy/unsupported-queries.ts` › `updateMany` — rejects `relationLoadStrategy` on updateMany (type + runtime) — Prisma 8 has no `relationLoadStrategy` query option to reject.
- `packages/client/tests/functional/relation-load-strategy/unsupported-queries.ts` › `deleteMany` — rejects `relationLoadStrategy` on deleteMany (type + runtime) — Prisma 8 has no `relationLoadStrategy` query option to reject.
- `packages/client/tests/functional/relation-load-strategy/unsupported-queries.ts` › `count` — rejects `relationLoadStrategy` on count (type + runtime) — Prisma 8 has no `relationLoadStrategy` query option to reject.
