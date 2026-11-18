# Non-ported — issues-10000

- `packages/client/tests/functional/issues/10000/tests.ts` › `issue 10000` — `@map`ped column names (`event_id`) resolve correctly through a relation include (`createMany` + `include: { sessions: true }`) — MySQL-only (`_matrix.ts`: `{ provider: Providers.MYSQL }` only; all other providers including postgres, mongodb, cockroachdb, sqlserver, sqlite are listed in `optOut.from`). No MySQL target in Prisma 8.
