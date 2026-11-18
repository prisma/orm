# Non-ported — issues-11322

- `packages/client/tests/functional/issues/11322/tests.ts` › `example` — BigInt foreign key resolves through M:N relation (`categories` via `set`) and is returned correctly as `BigInt('1')` — MySQL-only (`_matrix.ts`: `{ provider: Providers.MYSQL }` only; `optOut.from: ['sqlite', 'postgresql', 'mongodb', 'cockroachdb', 'sqlserver']`). No MySQL target in Prisma 8.
