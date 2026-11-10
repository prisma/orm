# Prisma 6 MongoDB reader fixtures

Each folder is one case: a Prisma 6 MongoDB schema (`schema.prisma`, or a `schema/` folder for multi-file cases) and either `expected-contract.json` or `expected-diagnostics.json`. `../fixtures.test.ts` reads every case through the Mongo target's binding and the Mongo control stack, and compares the result with the expected file. A contract is first serialized and checked by the Mongo target serializer, as `contract emit` does.

There is one case per rule row and per error code in the reader's rule table; the test pins the case list. Set `UPDATE_PRISMA6_FIXTURES=1` to rewrite the expected files after an intentional change, then run `pnpm biome format --write` on this folder.

`PSL.PRISMA6_MONGO_CONTRACT_INVALID` has no case here: it reports a contract the reader built but Prisma 8 rejects, which no schema should produce. `../provider.test.ts` covers it with a codec lookup that fails.
