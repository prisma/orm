# non-ported: batching-bigint

Source: `packages/client/tests/functional/batching-bigint/tests.ts`

The `Promise.all` tests are ported (see `test/ports/prisma/functional/batching-bigint/`).
The two tests that use the array/batch `$transaction([findUnique, findUnique])` form have
no Prisma 8 equivalent and remain non-ported.

- `packages/client/tests/functional/batching-bigint/tests.ts` › `findUnique bigint with $transaction([...])` — subject: array-batch $transaction correctly round-trips BigInt unique-key lookups — non-ported (no array/batch $transaction surface in Prisma 8)
- `packages/client/tests/functional/batching-bigint/tests.ts` › `findFirst bigint with $transaction([...])` — subject: array-batch $transaction correctly round-trips BigInt findFirst lookups — non-ported (no array/batch $transaction surface in Prisma 8)
