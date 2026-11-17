# Non-ported — raw-queries/send-type-hints

The subject of every test is passing a `Uint8Array` as a bind parameter to `$queryRaw`/`$executeRaw` tagged-templates and `Prisma.sql` helpers, then asserting the value round-trips. Prisma 8 has no `Prisma.sql` helper. It does have a raw lane, ``db.raw.sql`…` ``, so whether the tagged-template cases can be ported with a `Uint8Array` interpolated there needs re-examination.

- `packages/client/tests/functional/raw-queries/send-type-hints/tests.ts` › `Uint8Array ($queryRaw)` — verifies `Uint8Array` bind in `$queryRaw` tagged-template round-trips — `$queryRaw` tagged-template absent in Prisma 8
- `packages/client/tests/functional/raw-queries/send-type-hints/tests.ts` › `Uint8Array ($executeRaw)` — verifies `Uint8Array` bind in `$executeRaw` tagged-template — `$executeRaw` tagged-template absent in Prisma 8
- `packages/client/tests/functional/raw-queries/send-type-hints/tests.ts` › `Uint8Array ($queryRaw + Prisma.sql)` — verifies `Uint8Array` bind in `prisma.$queryRaw(Prisma.sql\`…\`)` — `$queryRaw`/`Prisma.sql` absent in Prisma 8
- `packages/client/tests/functional/raw-queries/send-type-hints/tests.ts` › `Uint8Array ($executeRaw + Prisma.sql)` — verifies `Uint8Array` bind in `prisma.$executeRaw(Prisma.sql\`…\`)` — `$executeRaw`/`Prisma.sql` absent in Prisma 8
