# Non-ported — issues-21967-mapped-enum

- `packages/client/tests/functional/issues/21967-mapped-enum/test.ts` › `correctly returns mapped enums` — MySQL mapped enum values (`neplátce`/`plátce`) round-trip through `findMany` with `select` — MySQL-only (`_matrix.ts`: `[[{ provider: Providers.MYSQL }]]`; `optOut.from: ['postgresql', 'cockroachdb', 'mongodb', 'sqlite', 'sqlserver']`). No MySQL target in Prisma 8.
