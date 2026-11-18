# Non-ported — query-validation

- `packages/client/tests/functional/query-validation/tests.ts` › `include and select are used at the same time` — findMany with both select+include rejects with inline-snapshot error — `@ts-expect-error` + Prisma error snapshot; no client-side codegen or inline-snapshot error format in Prisma 8
- `packages/client/tests/functional/query-validation/tests.ts` › `include used on scalar field` — include on scalar field rejects — `@ts-expect-error` + Prisma error snapshot; no equivalent surface in Prisma 8
- `packages/client/tests/functional/query-validation/tests.ts` › `undefined within array` — `OR:[undefined]` rejects — `@ts-expect-error` + Prisma error snapshot; no equivalent surface in Prisma 8
- `packages/client/tests/functional/query-validation/tests.ts` › `unknown selection field` — select of unknown field rejects — `@ts-expect-error` + Prisma error snapshot; no equivalent surface in Prisma 8
- `packages/client/tests/functional/query-validation/tests.ts` › `empty selection` — empty select rejects — Prisma error snapshot; no runtime equivalent in Prisma 8
- `packages/client/tests/functional/query-validation/tests.ts` › `unknown argument` — unknown argument rejects — `@ts-expect-error` + Prisma error snapshot; no equivalent surface in Prisma 8
- `packages/client/tests/functional/query-validation/tests.ts` › `unknown object field` — unknown where field rejects — `@ts-expect-error` + Prisma error snapshot; no equivalent surface in Prisma 8
- `packages/client/tests/functional/query-validation/tests.ts` › `missing required argument: nested` — create with empty data rejects "Argument email is missing" — `@ts-expect-error` + Prisma error snapshot; no equivalent surface in Prisma 8
- `packages/client/tests/functional/query-validation/tests.ts` › `invalid argument type` — findUnique with wrong-typed value rejects — `@ts-expect-error` + Prisma error snapshot; no equivalent surface in Prisma 8
- `packages/client/tests/functional/query-validation/tests.ts` › `invalid field ref` — field-reference validation error — `@ts-expect-error` + Prisma error snapshot; `prisma.pet.fields.name` has no ORM equivalent
- `packages/client/tests/functional/query-validation/tests.ts` › `union error` — union validation error — `@ts-expect-error` + Prisma error snapshot; no equivalent surface in Prisma 8
- `packages/client/tests/functional/query-validation/tests.ts` › `union error: different paths` — union validation error across paths — `@ts-expect-error` + Prisma error snapshot; no equivalent surface in Prisma 8
- `packages/client/tests/functional/query-validation/tests.ts` › `union error: invalid argument type vs required argument missing` — union validation error — `@ts-expect-error` + Prisma error snapshot; no equivalent surface in Prisma 8
- `packages/client/tests/functional/query-validation/tests.ts` › `invalid argument value` — invalid ISO-8601 DateTime value rejects — Prisma error snapshot; Prisma 8 validates at the pg driver level, not via the same error format
- `packages/client/tests/functional/query-validation/tests.ts` › `missing one of the specific required fields` — findUnique missing unique key rejects — `@ts-expect-error` + Prisma error snapshot; no equivalent surface in Prisma 8
- `packages/client/tests/functional/query-validation/tests.ts` › `non-serializable value` — non-serializable where value rejects — `@ts-expect-error` + Prisma error snapshot; no equivalent surface in Prisma 8
