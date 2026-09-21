# Non-ported — issues-29160-mysql-precision-loss

- `packages/client/tests/functional/issues/29160-mysql-precision-loss/tests.ts` › `preserves precision for large decimal values` — MySQL/MariaDB large-decimal `increment`/`decrement` preserves full precision — MySQL-only (`_matrix.ts`: `[[{ provider: Providers.MYSQL }]]`; `optOut.from: ['sqlserver', 'cockroachdb', 'mongodb', 'postgresql', 'sqlite']`). No MySQL target in Prisma 8.
