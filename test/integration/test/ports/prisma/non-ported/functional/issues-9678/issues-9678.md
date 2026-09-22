# Non-ported — issues-9678

- `packages/client/tests/functional/issues/9678/tests.ts` › `concurrent deleteMany/createMany` — concurrent deleteMany+createMany retries on write-conflict without corrupting data — `$transaction([...], { isolationLevel })` has no transaction-with-isolation-level API in Prisma 8; also uses `jest.retryTimes` + `testIf` with no harness equivalent
