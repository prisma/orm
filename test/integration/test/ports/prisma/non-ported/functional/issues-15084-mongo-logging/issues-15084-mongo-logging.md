# non-ported: issues-15084-mongo-logging

Source: `packages/client/tests/functional/issues/15084-mongo-logging/tests.ts`

Regression test for #15084: when Prisma Client is configured with `log:[{emit:'event',level:'query'}]`,
the `$on('query', handler)` event fires with a query-log object containing `timestamp`, `query`,
`params`, `duration`, and `target`; the logged query string for a mongo findMany is the raw aggregation
pipeline string. Prisma 8 has no `$on`/log-event surface on any mongo facade.

- `packages/client/tests/functional/issues/15084-mongo-logging/tests.ts` › `should log queries` — subject: mongo query events emitted to `$on('query', ...)` contain a structured log object with `timestamp`, `query`, `params`, `duration`, `target`, and the exact aggregation pipeline string — non-ported (Prisma 8 mongo has no `$on`/query-log-event surface; no mechanism to subscribe to query events)
