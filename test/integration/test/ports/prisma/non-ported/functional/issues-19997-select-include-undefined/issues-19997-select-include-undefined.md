# Non-ported — issues-19997-select-include-undefined

- `packages/client/tests/functional/issues/19997-select-include-undefined/tests.ts` › `correctly infers selection when passing select: undefined` — subject: passing an explicit `undefined` to the `select` argument is treated as "no selection" by Prisma — Prisma 8 has no optional select/include argument to pass `undefined` to; omitting the call tests something different
- `packages/client/tests/functional/issues/19997-select-include-undefined/tests.ts` › `correctly infers selection when passing include: undefined` — subject: passing an explicit `undefined` to the `include` argument is treated as "no include" by Prisma — Prisma 8 has no optional select/include argument to pass `undefined` to; omitting the call tests something different
