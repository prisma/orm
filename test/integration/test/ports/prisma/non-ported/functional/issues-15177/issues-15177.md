# Non-ported: issues/15177

Source: `prisma/prisma@a6d0155 packages/client/tests/functional/issues/15177`
Provider: sqlProviders (postgres entry would apply; mongo opted-out)

- `packages/client/tests/functional/issues/15177/tests.ts` › `should allow CRUD methods on a table column that has a space` — verifies create/read/update/delete on a model field mapped via `@map("user id")` to a column name containing a space — Prisma 8's DTS emitter generates `readonly user id: ...` which is not valid TypeScript syntax; the contract emit fails with a TypeScript parse error in the generated `contract.d.ts` ("Property or signature expected" at the space in the column name); the faithful schema cannot be emitted
