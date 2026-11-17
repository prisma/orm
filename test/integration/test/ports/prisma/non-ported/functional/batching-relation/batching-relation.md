# non-ported: batching-relation

Source: `packages/client/tests/functional/batching-relation/tests.ts`

Every test verifies batching behavior of `findUnique`/`findFirst` calls with an `include`
clause, measured via `queriesExecuted` counts. Specifically:
- `findUnique` with `include` DOES batch (queriesExecuted=2 for 2 artists, not 4)
- `findFirst` with `include` does NOT batch (queriesExecuted=4)

The subject of every test is the engine's batching/non-batching decision for queries
that include relations. Prisma 8 uses LATERAL/json_agg for relation includes (a
single query, not multiple), so there is no batching telemetry surface and the
queriesExecuted counts are inexpressible.

- `packages/client/tests/functional/batching-relation/tests.ts` › `batches findUnique that includes a relation` — subject: concurrent findUnique+include coalesces to 2 queries (not 4) — non-ported (engine-level batching telemetry inexpressible; Prisma 8 LATERAL/json_agg issues one query for both rows)
- `packages/client/tests/functional/batching-relation/tests.ts` › `does not batch findFirst that includes a relation` — subject: concurrent findFirst+include does NOT coalesce (queriesExecuted=4) — non-ported (engine-level batching telemetry inexpressible)
- `packages/client/tests/functional/batching-relation/tests.ts` › `batches findUniqueOrThrow that includes a relation with an error` — subject: concurrent findUniqueOrThrow+include coalesces (queriesExecuted=2); missing artist slot rejects per-slot — non-ported (engine-level batching telemetry inexpressible)
