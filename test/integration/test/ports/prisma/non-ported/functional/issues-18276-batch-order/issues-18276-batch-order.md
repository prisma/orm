# Non-ported — issues-18276-batch-order

Both tests verify the *query-log ordering* of statements issued inside an array/batch `$transaction([...])`, driven by `$queryRawUnsafe` plus a client `$extends({ query: { $queryRawUnsafe } })` middleware wrapper, inspected via the `$on('query', ...)` event log. Prisma 8 has none of: array/batch `$transaction([...])`, `$queryRawUnsafe`, `$extends` query middleware, or a `$on('query')` statement log. The subject (interleaved batch-statement ordering under extensions+middleware) cannot be re-expressed.

- `packages/client/tests/functional/issues/18276-batch-order/tests.ts` › `executes batch queries in the right order when using extensions + middleware` — depends on array/batch `$transaction([...])` + `$queryRawUnsafe` + `$extends` query middleware + `$on('query')` log, none of which exist in Prisma 8
- `packages/client/tests/functional/issues/18276-batch-order/tests.ts` › `executes batch in right order when using delayed middleware` — depends on array/batch `$transaction([...])` + `$queryRawUnsafe` + `$on('query')` log, none of which exist in Prisma 8
