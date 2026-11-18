# Non-ported — accelerate-bad-url-errors

All 3 tests are gated on `testIf(clientMeta.dataProxy)` — they run only in Data Proxy (Accelerate) client mode. The subject is Prisma Accelerate URL validation (`invalid://` / `prisma://` missing a valid API key). Prisma 8 has no Accelerate/Data Proxy surface (verified: no `dataProxy`/`Accelerate`/`prisma://` in `packages/`).

- `packages/client/tests/functional/accelerate-bad-url-errors/tests.ts` › `url starts with invalid://` — verifies Accelerate error "the URL must start with the protocol `prisma://`" — Accelerate-specific; `clientMeta.dataProxy` gate absent in Prisma 8
- `packages/client/tests/functional/accelerate-bad-url-errors/tests.ts` › `url starts with prisma:// but is invalid` — verifies Accelerate error "the URL must contain a valid API key" — Accelerate-specific; no Accelerate surface in Prisma 8
- `packages/client/tests/functional/accelerate-bad-url-errors/tests.ts` › `url starts with prisma:// with nothing else` — verifies Accelerate error "the URL must contain a valid API key" — Accelerate-specific; no Accelerate surface in Prisma 8
