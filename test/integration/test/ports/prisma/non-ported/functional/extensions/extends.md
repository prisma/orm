# non-ported: extensions/extends

Source: `packages/client/tests/functional/extensions/extends.ts`

Every test in this file exercises the Prisma Client `$extends({...})` extension mechanism.
Prisma 8 has no `$extends` client-extension surface at all — the `packages/3-extensions/`
directory in this repo refers to PostgreSQL database extensions (pgvector, ParadeDB, PostGIS,
Supabase), not client-level extensions. Confirmed by grepping `packages/` for `$extends`,
`getExtensionContext`, `defineExtension`, `$parent`, `customDataProxyFetch` (zero hits outside
node_modules/dist). The subject of each test IS the extension mechanism itself, so there is no
faithful re-expressible subject.

- `packages/client/tests/functional/extensions/extends.ts` › `extended extension functions normally` — subject: `prisma.$extends({})` returns a new client instance (not same reference) with `$on` removed from the type, and `xprisma.user.findMany()` delegates — non-ported (no `$extends` client-extension surface; subject is the core `$extends` mechanics)
- `packages/client/tests/functional/extensions/extends.ts` › `does not recompute extensions property on every access` — subject: `(xprisma as any)._extensions` is referentially stable across accesses — non-ported (no `$extends` client-extension surface; subject is internal `$extends` caching)
