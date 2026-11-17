# Non-ported: issues/11233

Source: `packages/client/tests/functional/issues/11233/tests.ts`

Matrix: `sqlProviders` (postgres, mysql, cockroachdb, sqlserver, sqlite) — MongoDB opted out.

- `packages/client/tests/functional/issues/11233/tests.ts` › `should not throw when using Prisma.empty inside $executeRaw` — verifies that passing `Prisma.empty` (the Prisma SQL template tag that produces an empty query) to `$executeRaw` returns `0` on postgres (or errors with a provider-specific message on other databases) — `Prisma.empty` is a Prisma-specific sentinel value from `@prisma/client` with no Prisma 8 equivalent; `$executeRaw` is a Prisma Client API with no Prisma 8 equivalent (Prisma 8's `sql()` builder requires explicit SQL, not an empty sentinel).
- `packages/client/tests/functional/issues/11233/tests.ts` › `should not throw when using Prisma.empty inside $queryRaw` — verifies that passing `Prisma.empty` to `$queryRaw` returns `[]` on postgres (or errors with a provider-specific message on other databases) — same gap: `Prisma.empty` and `$queryRaw` are Prisma-specific APIs with no Prisma 8 equivalents.
