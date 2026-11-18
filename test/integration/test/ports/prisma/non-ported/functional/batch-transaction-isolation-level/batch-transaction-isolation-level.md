# non-ported: batch-transaction-isolation-level

Source: `packages/client/tests/functional/batch-transaction-isolation-level/tests.ts`

Every test uses `$transaction([...], { isolationLevel })` (the array/batch form with an
isolation-level option). Prisma 8 has neither the array/batch `$transaction([...])` surface
nor an `isolationLevel` option on its `transaction()` facade.

- `packages/client/tests/functional/batch-transaction-isolation-level/tests.ts` › `ReadUncommitted` — subject: array-batch $transaction emits `SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED` — non-ported (no array/batch $transaction; no isolationLevel option in Prisma 8 transaction())
- `packages/client/tests/functional/batch-transaction-isolation-level/tests.ts` › `ReadCommitted` — subject: array-batch $transaction emits `SET TRANSACTION ISOLATION LEVEL READ COMMITTED` — non-ported (no array/batch $transaction; no isolationLevel option in Prisma 8 transaction())
- `packages/client/tests/functional/batch-transaction-isolation-level/tests.ts` › `RepeatableRead` — subject: array-batch $transaction emits `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ` — non-ported (no array/batch $transaction; no isolationLevel option in Prisma 8 transaction())
- `packages/client/tests/functional/batch-transaction-isolation-level/tests.ts` › `Serializable` — subject: array-batch $transaction emits `SET TRANSACTION ISOLATION LEVEL SERIALIZABLE` — non-ported (no array/batch $transaction; no isolationLevel option in Prisma 8 transaction())
- `packages/client/tests/functional/batch-transaction-isolation-level/tests.ts` › `default value generates no SET TRANSACTION ISOLATION LEVEL statements (unless running MSSQL)` — subject: array-batch $transaction without isolationLevel emits no SET TRANSACTION statement — non-ported (no array/batch $transaction surface in Prisma 8)
- `packages/client/tests/functional/batch-transaction-isolation-level/tests.ts` › `invalid level generates run- and compile- time error` — subject: array-batch $transaction with invalid isolationLevel string rejects at runtime and type-errors — non-ported (no array/batch $transaction surface in Prisma 8)
