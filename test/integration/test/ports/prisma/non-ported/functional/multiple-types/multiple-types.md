# Non-ported — multiple-types

- `packages/client/tests/functional/multiple-types/tests.ts` › `shows differences between queryRaw and findMany` — the entire test is about comparing `$queryRaw` output to `findMany` output to document Prisma's type coercion differences; `$queryRaw` does not exist in Prisma 8
