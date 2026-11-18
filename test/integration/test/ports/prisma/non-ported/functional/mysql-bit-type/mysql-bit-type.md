# Non-ported — mysql-bit-type

Matrix is `[[{ provider: Providers.MYSQL }]]` — MySQL-only. Prisma 8 has no MySQL target (verified: no `packages/3-targets/*/mysql`). All tests are non-ported.

- `packages/client/tests/functional/mysql-bit-type/tests.ts` › `bytes field > all bytes` — verifies MySQL `@db.Bit(64)` roundtrip with `Uint8Array` — MySQL-only; Prisma 8 has no MySQL target
- `packages/client/tests/functional/mysql-bit-type/tests.ts` › `bytes field > empty byte array` — verifies MySQL `@db.Bit(64)` zero-padding of empty `Uint8Array` — MySQL-only; Prisma 8 has no MySQL target
- `packages/client/tests/functional/mysql-bit-type/tests.ts` › `bytes field > too many bytes` — verifies MySQL out-of-range error for oversized `@db.Bit(64)` byte array — MySQL-only; Prisma 8 has no MySQL target
- `packages/client/tests/functional/mysql-bit-type/tests.ts` › `boolean fields` — verifies MySQL `@db.Bit(1)` maps to boolean `true`/`false` — MySQL-only; Prisma 8 has no MySQL target
- `packages/client/tests/functional/mysql-bit-type/tests.ts` › `raw query` — verifies `$queryRaw\`SELECT b'1' AS bit\`` returns `Uint8Array.from([1])` on MySQL — MySQL-only; Prisma 8 has no MySQL target; also `$queryRaw` tagged-template absent in Prisma 8
