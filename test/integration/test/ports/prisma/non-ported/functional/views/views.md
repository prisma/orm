# Non-ported — views

- `packages/client/tests/functional/views/tests.ts` › `should simple query a view` — `findFirst()` on a view model — Prisma 8 has no view entity support in PSL/contract/ORM
- `packages/client/tests/functional/views/tests.ts` › `should query a view with where` — `findMany({ where: { email } })` on view — Prisma 8 has no view entity support
- `packages/client/tests/functional/views/tests.ts` › `should query views with a related column` — `findFirst({ select: { bio } })` on view — Prisma 8 has no view entity support
- `packages/client/tests/functional/views/tests.ts` › `should require orderBy when take is provided in non-aggregation method` — view findMany without orderBy throws when take provided — Prisma 8 has no view entity support
- `packages/client/tests/functional/views/tests.ts` › `should require orderBy when skip is provided in non-aggregation method` — view findMany without orderBy throws when skip provided — Prisma 8 has no view entity support
- `packages/client/tests/functional/views/tests.ts` › `should require orderBy when take is provided in groupBy` — view groupBy without orderBy throws when take provided — Prisma 8 has no view entity support
- `packages/client/tests/functional/views/tests.ts` › `should require orderBy when skip is provided in groupBy` — view groupBy without orderBy throws when skip provided — Prisma 8 has no view entity support
