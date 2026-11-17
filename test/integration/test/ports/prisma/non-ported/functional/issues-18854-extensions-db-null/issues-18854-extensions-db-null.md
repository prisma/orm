# Non-ported — issues-18854-extensions-db-null

Matrix: postgresql, sqlite, mysql, cockroachdb (sqlserver and mongodb excluded). 1 test. Subject = the `Prisma.DbNull` sentinel value works correctly when passed through a query-type `$extends` extension (`$allModels.$allOperations`). The test requires both a `$extends` query extension and the `Prisma.DbNull` sentinel; Prisma 8 has neither → non-ported.

- `packages/client/tests/functional/issues/18854-extensions-db-null/tests.ts` › `allows to use DbNull together with query extensions` — verifies `Prisma.DbNull` can be passed in `create` data through a `$extends` query extension without error — no `$extends`/`Prisma.DbNull` surface in Prisma 8
