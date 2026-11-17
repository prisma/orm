# non-ported: batching

Source: `packages/client/tests/functional/batching/tests.ts`

Every test in this suite verifies that Prisma Client's dataloader/batch-request mechanism
coalesces concurrent `findUnique` calls into a single engine roundtrip, measured by
instrumenting `engine.requestBatch` on the internal `_engine` instance. Prisma 8
exposes no equivalent internal batching telemetry: there is no `_engine.requestBatch`
interceptable surface on the `postgres(...)` facade. Even where result values can be
expressed, the batching-count assertions (`engineRequestBatchCount === 1`,
`queriesExecuted === 1`) are inexpressible.

- `packages/client/tests/functional/batching/tests.ts` › `batches findUnique` — subject: two concurrent findUnique calls coalesce into 1 engine request (queriesExecuted=1) — non-ported (engine-level batching telemetry inexpressible in Prisma 8; no requestBatch interception surface)
- `packages/client/tests/functional/batching/tests.ts` › `batches findUnique (issue 27363)` — subject: concurrent findUnique with same id/select coalesces into 1 engine request — non-ported (engine-level batching telemetry inexpressible)
- `packages/client/tests/functional/batching/tests.ts` › `batches findUnique with re-ordered selection` — subject: findUnique with field-order-swapped select still batches (queriesExecuted=1) — non-ported (engine-level batching telemetry inexpressible)
- `packages/client/tests/functional/batching/tests.ts` › `batches repeated findUnique for the same row correctly` — subject: two findUnique for the same row coalesce and return identical results (queriesExecuted=1) — non-ported (engine-level batching telemetry inexpressible)
- `packages/client/tests/functional/batching/tests.ts` › `batches findUniqueOrThrow` — subject: two concurrent findUniqueOrThrow coalesce into 1 engine request — non-ported (engine-level batching telemetry inexpressible)
- `packages/client/tests/functional/batching/tests.ts` › `batches findUniqueOrThrow with an error` — subject: concurrent findUniqueOrThrow where one is missing coalesces (queriesExecuted=1) and the missing slot rejects — non-ported (engine-level batching telemetry inexpressible)
- `packages/client/tests/functional/batching/tests.ts` › `does not batch different models` — subject: findUnique calls on different models do NOT batch (queriesExecuted>1) — non-ported (engine-level batching telemetry inexpressible)
- `packages/client/tests/functional/batching/tests.ts` › `does not batch different where` — subject: findUnique calls with different where-key types do NOT batch — non-ported (engine-level batching telemetry inexpressible)
- `packages/client/tests/functional/batching/tests.ts` › `does not batch different select` — subject: findUnique calls with different select shapes do NOT batch — non-ported (engine-level batching telemetry inexpressible)
- `packages/client/tests/functional/batching/tests.ts` › `interactive transactions: batches findUnique for a single model` — subject: within an interactive transaction, N concurrent findUnique calls coalesce into exactly 1 engine batch request — non-ported (engine-level requestBatch telemetry inexpressible in Prisma 8)
- `packages/client/tests/functional/batching/tests.ts` › `interactive transactions: batches findUnique for multiple models` — subject: within an interactive transaction, N findUnique for posts + N for comments coalesce into exactly 2 engine batch requests — non-ported (engine-level requestBatch telemetry inexpressible in Prisma 8)
