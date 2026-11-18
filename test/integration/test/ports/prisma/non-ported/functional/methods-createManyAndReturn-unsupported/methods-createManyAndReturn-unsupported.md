# Non-ported — methods-createManyAndReturn-unsupported

- `packages/client/tests/functional/methods/createManyAndReturn-unsupported/tests.ts` › `should work as createMany is supported` — type assertion that `createMany` exists on a provider lacking InsertReturning — non-ported: Prisma 8 targets postgres (which has InsertReturning); SQLSERVER/MONGODB/MYSQL are not in-scope providers for this project
- `packages/client/tests/functional/methods/createManyAndReturn-unsupported/tests.ts` › `should fail as createManyAndReturn is not supported on tested providers` — `@ts-expect-error` + type assertion that `createManyAndReturn` does NOT exist on providers without InsertReturning — non-ported: same reason; Prisma 8 has no SQLSERVER/MONGODB/MYSQL integration harness
