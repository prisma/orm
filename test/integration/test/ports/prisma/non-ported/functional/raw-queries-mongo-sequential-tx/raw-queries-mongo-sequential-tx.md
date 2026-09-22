# Non-ported — raw-queries-mongo-sequential-tx

- `packages/client/tests/functional/raw-queries/mongo-sequential-tx/tests.ts` › `mongo raw queries should work in a sequential transaction` — submits `$runCommandRaw`, `findRaw`, and `aggregateRaw` together through array-form `$transaction` and asserts all three raw result envelopes in order — non-portable because prisma-8 exposes neither these Mongo raw-command/query APIs nor Prisma's array-form sequential transaction surface; callback transactions and Mongo ORM operations would substitute both mechanisms under test.
