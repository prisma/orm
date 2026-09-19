# Non-ported — issues-25481-typedsql-query-extension

Matrix: postgresql only (`optOut` from sqlite, mysql, mongodb, cockroachdb, sqlserver). 1 test. Subject = `$queryRawTyped(sql.findAllTest())` works when a `$extends` query-type extension wrapping `$allOperations` is applied. Requires both TypedSQL (`$queryRawTyped`) and `$extends`; Prisma 8 has neither → non-ported.

- `packages/client/tests/functional/issues/25481-typedsql-query-extension/test.ts` › `TypedSQL should work when a client extension of type query extension is used` — verifies `$queryRawTyped` executes correctly through a `$extends` query extension wrapping `$allOperations` — no `$queryRawTyped`/TypedSQL or `$extends` surface in Prisma 8
