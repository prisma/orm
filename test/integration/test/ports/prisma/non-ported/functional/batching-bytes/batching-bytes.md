# non-ported: batching-bytes

Source: `packages/client/tests/functional/batching-bytes/tests.ts`

The `Promise.all` tests are ported (see `test/ports/prisma/functional/batching-bytes/`).
The two tests that use the array/batch `$transaction([findUnique, findUnique])` form have
no Prisma 8 equivalent and remain non-ported.

- `packages/client/tests/functional/batching-bytes/tests.ts` › `findUnique bytes with $transaction([...])` — subject: array-batch $transaction correctly round-trips Bytes unique-key lookups — non-ported (no array/batch $transaction surface in Prisma 8)
- `packages/client/tests/functional/batching-bytes/tests.ts` › `findFirst bytes with $transaction([...])` — subject: array-batch $transaction correctly round-trips Bytes findFirst lookups — non-ported (no array/batch $transaction surface in Prisma 8)
