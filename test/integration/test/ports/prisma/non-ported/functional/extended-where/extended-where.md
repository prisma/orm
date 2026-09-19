# Non-ported — extended-where

- `packages/client/tests/functional/extended-where/aggregate.ts` › `aggregate with cursor 1 unique (PK)` — Collection.aggregate() ignores cursor state; `prisma.post.aggregate({ cursor, _count })` has no equivalent aggregation-with-cursor API in Prisma 8
- `packages/client/tests/functional/extended-where/aggregate.ts` › `aggregate with cursor 2 uniques (PK & non-PK)` — Collection.aggregate() ignores cursor state; same gap
- `packages/client/tests/functional/extended-where/aggregate.ts` › `update with where 1 unique (non-PK)` — Collection.aggregate() ignores cursor state; same gap
- `packages/client/tests/functional/extended-where/validation.ts` › `where and no keys provided` — tests Prisma-specific error message snapshot for `delete({ where: {} })` — error message format and `matchPrismaErrorInlineSnapshot` are Prisma-client-specific
- `packages/client/tests/functional/extended-where/validation.ts` › `where and missing unique keys` — same — error snapshot testing against Prisma client error format
- `packages/client/tests/functional/extended-where/validation.ts` › `AtLeast type with optional object` — `expectTypeOf` test against `Prisma.AtLeast<...>` utility type — Prisma-client type-level test with no runtime or ORM equivalent
- `packages/client/tests/functional/extended-where/validation.ts` › `AtLeast type with optional object and no keys` — same — type-only test
- `packages/client/tests/functional/extended-where/create.ts` › `create with connect 2 uniques (PK & non-PK)` — connect via a compound criterion `{ id, referralId }` — Prisma 8 connect criterion is a union of single-constraint objects; a compound multi-unique connect is a compile-time type error, not expressible
