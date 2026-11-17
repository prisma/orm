# non-ported: batch-transaction

Source: `packages/client/tests/functional/batch-transaction/tests.ts`

Every test in this suite uses the array/batch `$transaction([...])` form, which has no
equivalent in Prisma 8. Prisma 8 only exposes the interactive callback form
`transaction(async tx => { tx.orm... })`. The array/batch surface (which submits
pre-built query promises as an atomic batch) is absent from the public API.

- `packages/client/tests/functional/batch-transaction/tests.ts` › `runs a batch that requires serial execution` — subject: array-batch $transaction([create, findUnique]) executes serially and both results are returned — non-ported (no array/batch `$transaction([...])` surface in Prisma 8)
- `packages/client/tests/functional/batch-transaction/tests.ts` › `reverts a batch that fails half-way through` — subject: array-batch $transaction rolls back when a step fails mid-batch — non-ported (no array/batch `$transaction([...])` surface in Prisma 8)
- `packages/client/tests/functional/batch-transaction/tests.ts` › `commits a successful batch` — subject: array-batch $transaction commits all operations when all succeed — non-ported (no array/batch `$transaction([...])` surface in Prisma 8)
