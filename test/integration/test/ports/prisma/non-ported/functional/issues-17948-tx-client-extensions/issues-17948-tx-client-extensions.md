# Non-ported — issues-17948-tx-client-extensions

Matrix: all providers (skip for the D1 driver adapter). 1 test. Subject = a `$extends` model method that reaches the transaction client via `Prisma.getExtensionContext(this)` inside an interactive `$transaction` callback. Prisma 8 has no `$extends` surface and no `Prisma.getExtensionContext` — the extension-context binding under test cannot be expressed → non-ported.

- `packages/client/tests/functional/issues/17948-tx-client-extensions/tests.ts` › `extension method is bound to transaction client within itx` — verifies a `$extends` model method using `Prisma.getExtensionContext(this).findFirst` operates on the tx client inside `$transaction` — no `$extends`/`getExtensionContext` surface in Prisma 8
