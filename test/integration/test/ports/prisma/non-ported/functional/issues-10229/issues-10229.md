# Non-ported: issues/10229

Source: `packages/client/tests/functional/issues/10229/tests.ts`

Matrix: `postgresql`, `mysql`, `cockroachdb` — all with invalid connection URLs. SQLite, MongoDB, sqlserver opted out.

- `packages/client/tests/functional/issues/10229/tests.ts` › `should assert that the error has the correct errorCode` — verifies that when `prisma.$connect()` is called with an invalid connection URL, the thrown error is a `PrismaClientInitializationError` instance with `errorCode === 'P1001'` — `PrismaClientInitializationError` is a Prisma Client-specific error class and `P1001` is a Prisma-specific error code; Prisma 8 does not expose a `$connect()` method, does not use `PrismaClientInitializationError`, and does not emit `P1001` error codes. Connection initialization in Prisma 8 uses different error types with no equivalent `P1001` surface.
