# Non-ported — invalid-sqlite-isolation-level

- `packages/client/tests/functional/invalid-sqlite-isolation-level/tests.ts` › `invalid level generates run- and compile- time error` — passes `ReadUncommitted` to the array-form transaction API on SQLite and asserts both compile-time rejection and the SQLite connector conversion error — non-portable because the test is SQLite-only and Prisma 8 exposes callback transactions rather than Prisma's array-form `$transaction([...], { isolationLevel })` input.
