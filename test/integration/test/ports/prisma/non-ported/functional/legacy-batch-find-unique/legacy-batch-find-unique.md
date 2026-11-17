# Non-ported — legacy-batch-find-unique

- `packages/client/tests/functional/0-legacy-ports/batch-find-unique/tests.ts` › `findUnique batching` — concurrent `findUnique` coalesce into one `IN` query via `$on('query')` interception — Prisma 8 has no parallel-read coalescing or `$on('query')` event surface
