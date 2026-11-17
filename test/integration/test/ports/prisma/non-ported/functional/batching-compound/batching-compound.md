# non-ported: batching-compound

Source: `packages/client/tests/functional/batching-compound/tests.ts`

Every test verifies that `findUnique`/`findUniqueOrThrow` calls with a compound unique
key (`@@unique([firstName, lastName])`) coalesce into a single engine request, measured
via `queriesExecuted === 1`. Prisma 8 has no equivalent internal batching telemetry.
The batching mechanism is the subject of every test; result values are only incidental.

- `packages/client/tests/functional/batching-compound/tests.ts` › `batches findUnique with a compound ID` — subject: two concurrent findUnique by compound unique key coalesce into 1 engine request — non-ported (engine-level batching telemetry inexpressible in Prisma 8)
- `packages/client/tests/functional/batching-compound/tests.ts` › `batches repeated findUnique with a compound ID with same row correctly` — subject: two findUnique for the same compound-key row coalesce and both return the same row — non-ported (engine-level batching telemetry inexpressible in Prisma 8)
- `packages/client/tests/functional/batching-compound/tests.ts` › `batches findUniqueOrThrow with a compound ID with an error` — subject: concurrent findUniqueOrThrow by compound key coalesces (queriesExecuted=1); missing row rejects per slot — non-ported (engine-level batching telemetry inexpressible in Prisma 8)
