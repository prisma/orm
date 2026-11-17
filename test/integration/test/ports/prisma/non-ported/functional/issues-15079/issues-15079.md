# Non-ported — issues-15079

- `packages/client/tests/functional/issues/15079/tests.ts` › `should not throw an error when upserting a @db.Decimal(2, 0)` — SQL Server `@db.Decimal(2,0)` field upserts without error and returns correct `Prisma.Decimal` value — SQL Server-only (`_matrix.ts`: `{ provider: Providers.SQLSERVER }` only; `optOut.from: ['cockroachdb', 'mongodb', 'mysql', 'postgresql', 'sqlite']`). No SQL Server target in Prisma 8.
