# Non-ported — query-error-logging

The suite tests Prisma Client's error-level log event: `{ log: [{ emit: 'event', level: 'error' }] }` + `client.$on('error', cb)`. Each test expects a `LogEvent` with a `message` containing the Prisma error description and a `target` containing the method name. Prisma 8 has no `log` constructor option, no `$on()` event emitter, and no `LogEvent` type (verified: no such symbols in `packages/`). The subject is Prisma's error-log-event subsystem.

- `packages/client/tests/functional/query-error-logging/tests.ts` › `findUniqueOrThrown when error thrown` — verifies a `LogEvent` is emitted on `$on('error')` with specific `message` and `target` when `findUniqueOrThrow` fails (P2025) — no `$on`/log-event surface in Prisma 8
- `packages/client/tests/functional/query-error-logging/tests.ts` › `findFirstOrThrow when error thrown` — verifies a `LogEvent` is emitted on `$on('error')` with specific `message` and `target` when `findFirstOrThrow` fails (P2025) — no `$on`/log-event surface in Prisma 8
