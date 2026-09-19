# Non-ported: issues/21807-citext-neon

Source: `prisma/prisma@a6d0155 packages/client/tests/functional/issues/21807-citext-neon`
Provider: postgres only (cockroachdb/mysql/mongodb/sqlite/sqlserver opted-out upstream)

- `packages/client/tests/functional/issues/21807-citext-neon/tests.ts` › `writing and reading a citext field works` — verifies that a `String @db.Citext` field is stored and queried case-insensitively via `WHERE slug = 'SomesluG'` — Prisma 8 has no `citext` codec (`@db.Citext` is not a recognized native type in PSL; no `pg/citext@1` descriptor exists); the contract emit fails with `PSL_UNSUPPORTED_FIELD_ATTRIBUTE`; the faithful schema cannot be authored or pushed
