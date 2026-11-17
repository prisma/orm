# Non-ported — issues-29122-mysql-bigint-view-relation

- `packages/client/tests/functional/issues/29122-mysql-bigint-view-relation/tests.ts` › `correctly handles an integer key returned from a view relation in MySQL` — MySQL view relation with BigInt key returns correct integer from `findMany` with `include` — MySQL-only (`_matrix.ts`: `[[{ provider: Providers.MYSQL }]]`; `optOut.from: ['postgresql', 'sqlite', 'cockroachdb', 'sqlserver', 'mongodb']`). No MySQL target in Prisma 8; views also not supported.
