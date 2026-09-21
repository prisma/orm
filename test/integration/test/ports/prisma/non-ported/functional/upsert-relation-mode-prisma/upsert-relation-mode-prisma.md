# Non-ported — upsert-relation-mode-prisma

- `packages/client/tests/functional/upsert-relation-mode-prisma/test.ts` › `calling upsert two times in a row does nothing` — runs the same generic upsert twice under `relationMode = "prisma"` and verifies the returned identifier and value for the PostgreSQL and MongoDB matrix entries — Prisma 8 has no public equivalent of Prisma's `relationMode = "prisma"` relation-emulation context, so an ordinary native PostgreSQL or MongoDB upsert would exercise a different mechanism; the faithful PostgreSQL schema also requires unsupported `@default(cuid())`.
