# Non-ported — tracing

The entire suite tests the `@prisma/instrumentation` OpenTelemetry integration (`PrismaInstrumentation`, `BasicTracerProvider`, `InMemorySpanExporter`, Prisma's internal span names `prisma:client:operation`/`compile`/`serialize`, `prisma:engine:db_query`, etc.). Prisma 8 has no OpenTelemetry instrumentation surface, no `PrismaInstrumentation`, no span names, and no `$connect`/`$disconnect` lifecycle. The subject of every test is the span tree emitted by Prisma's tracing subsystem — a surface that does not exist in Prisma 8.

- `packages/client/tests/functional/tracing/tests.ts` › `tracing on crud methods > create` — verifies span tree for `user.create` — no OTel/instrumentation surface in Prisma 8
- `packages/client/tests/functional/tracing/tests.ts` › `tracing on crud methods > read` — verifies span tree for `user.findMany` — no OTel/instrumentation surface in Prisma 8
- `packages/client/tests/functional/tracing/tests.ts` › `tracing on crud methods > update` — verifies span tree for `user.update` — no OTel/instrumentation surface in Prisma 8
- `packages/client/tests/functional/tracing/tests.ts` › `tracing on crud methods > delete` — verifies span tree for `user.delete` — no OTel/instrumentation surface in Prisma 8
- `packages/client/tests/functional/tracing/tests.ts` › `tracing on crud methods > deleteMany()` — verifies span tree for `user.deleteMany` — no OTel/instrumentation surface in Prisma 8
- `packages/client/tests/functional/tracing/tests.ts` › `tracing on crud methods > count` — verifies span tree for `user.count` — no OTel/instrumentation surface in Prisma 8
- `packages/client/tests/functional/tracing/tests.ts` › `tracing on crud methods > aggregate` — verifies span tree for `user.aggregate` — no OTel/instrumentation surface in Prisma 8
- `packages/client/tests/functional/tracing/tests.ts` › `tracing on transactions > $transaction` — verifies span tree for array `$transaction` batch — no OTel/instrumentation surface; also array `$transaction` form absent in Prisma 8
- `packages/client/tests/functional/tracing/tests.ts` › `tracing on transactions > interactive transaction commit` — verifies span tree for interactive `$transaction` including `itxOperation('commit')` span — no OTel/instrumentation surface in Prisma 8
- `packages/client/tests/functional/tracing/tests.ts` › `tracing on transactions > interactive transaction rollback` — verifies span tree for `$transaction` rollback including `itxOperation('rollback')` span — no OTel/instrumentation surface in Prisma 8
- `packages/client/tests/functional/tracing/tests.ts` › `tracing on $raw methods > $queryRaw` — verifies span tree for `$queryRaw` (non-mongo only) — no OTel/instrumentation surface; `$queryRaw` tagged-template also absent in Prisma 8
- `packages/client/tests/functional/tracing/tests.ts` › `tracing on $raw methods > $executeRaw` — verifies span tree for `$executeRaw` (non-mongo, non-sqlite) — no OTel/instrumentation surface; `$executeRaw` also absent in Prisma 8
- `packages/client/tests/functional/tracing/tests.ts` › `tracing with custom span` — verifies Prisma span is nested under a user-created `tracer.startActiveSpan` span — no OTel/instrumentation surface in Prisma 8
- `packages/client/tests/functional/tracing/tests.ts` › `tracing connect > should trace the implicit $connect call` — verifies `prisma:client:connect` span on first implicit connect — no OTel/instrumentation surface, no `$connect` lifecycle in Prisma 8
- `packages/client/tests/functional/tracing/tests.ts` › `tracing connect > should trace the explicit $connect call` — verifies `prisma:client:connect` span on explicit `$connect()` — no OTel/instrumentation surface, no `$connect` in Prisma 8
- `packages/client/tests/functional/tracing/tests.ts` › `tracing disconnect > should trace $disconnect` — verifies `prisma:client:disconnect` span on `$disconnect()` — no OTel/instrumentation surface, no `$disconnect` in Prisma 8
