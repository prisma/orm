# Non-ported — issues-9007

- `packages/client/tests/functional/issues/9007/tests.ts` › `should throw an error if using contains filter on uuid type` — `contains` filter on a UUID column raises a validation error — runtime throw requires `@ts-expect-error`; Prisma 8 enforces this at compile time only, no runtime equivalent
- `packages/client/tests/functional/issues/9007/tests.ts` › `should not generate the contains field on the where type` — `contains` absent from generated UUID where-input type — `expectTypeOf<Prisma.UuidFilter>` Prisma Client type test; Prisma 8 has no generated `UuidFilter` type
