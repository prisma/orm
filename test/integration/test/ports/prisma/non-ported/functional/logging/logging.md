# Non-ported — logging

The suite tests Prisma Client's `log` constructor option and `$on('query', …)` event emitter: each test creates a client with `{ log: [{ emit: 'event', level: 'query' }] }` and subscribes to `client.$on('query', cb)` to receive `Prisma.QueryEvent` objects (`query`, `duration`, `timestamp`, `params`, `target`). Prisma 8 has no `log` constructor option, no `$on()` event emitter, and no `QueryEvent` surface (verified: no such symbols in `packages/`).

- `packages/client/tests/functional/logging/tests.ts` › `should log queries on a method call` — verifies `QueryEvent` fields emitted via `$on('query')` — no `$on`/log-event surface in Prisma 8
- `packages/client/tests/functional/logging/tests.ts` › `should log queries inside a ITX` — verifies `QueryEvent` sequence (BEGIN, INSERT, SELECT, COMMIT) inside an interactive transaction via `$on('query')` — no `$on`/log-event surface in Prisma 8
- `packages/client/tests/functional/logging/tests.ts` › `should log batched queries inside a ITX` — verifies `QueryEvent` sequence for parallel queries inside a transaction via `$on('query')` — no `$on`/log-event surface in Prisma 8
- `packages/client/tests/functional/logging/tests.ts` › `should log transaction batched queries` — verifies `QueryEvent` sequence for array `$transaction([q1, q2])` via `$on('query')` — no `$on`/log-event surface; also array `$transaction` form absent in Prisma 8
