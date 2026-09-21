# Non-ported — issues-15264-uint-id-overflow

- `packages/client/tests/functional/issues/15264-uint-id-overflow/tests.ts` › `upsert should not fail` — MySQL unsigned-int id value near Int overflow (`2147483647 + 1`) does not cause upsert to fail — MySQL-only (`_matrix.ts`: `{ provider: Providers.MYSQL }` only; `optOut.from: ['sqlite', 'postgresql', 'mongodb', 'cockroachdb', 'sqlserver']`). No MySQL target in Prisma 8.
