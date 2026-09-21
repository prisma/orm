# Non-ported — driver-adapters-error-forwarding

- `packages/client/tests/functional/driver-adapters/error-forwarding/tests.ts` › `correctly forwards error for executeRaw` — an adapter `executeRaw` error is returned by identity from `$executeRaw` — Prisma 8 has no public top-level raw statement execution operation equivalent to `$executeRaw`; its `raw` SQL tag builds expressions rather than executable statements.
- `packages/client/tests/functional/driver-adapters/error-forwarding/tests.ts` › `correctly forwards error for batch transactions` — an adapter start-transaction error is returned by identity from `$transaction([...])` — Prisma 8 has no array/batch transaction surface; callback transactions are a different API form.
