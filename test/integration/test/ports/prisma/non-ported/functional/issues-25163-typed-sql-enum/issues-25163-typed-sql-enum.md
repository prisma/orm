# Non-ported — issues-25163-typed-sql-enum

Matrix: postgresql, cockroachdb (`optOut` from sqlite, mysql, mongodb, sqlserver). 1 test. Subject = `$queryRawTyped(sql.getUser())` — Prisma TypedSQL (`prisma/sql` generated module + `$queryRawTyped`) returns enum values whose names are invalid JS identifiers correctly, typed against `$DbEnums`. Prisma 8 has no `$queryRawTyped`/TypedSQL codegen surface → non-ported.

- `packages/client/tests/functional/issues/25163-typed-sql-enum/test.ts` › `returns enums that are mapped to invalid JS identifier correctly` — verifies `$queryRawTyped` returns enum values (`ADMIN`, `STEVE`) and types them against `$DbEnums` from the generated sql module — no `$queryRawTyped`/TypedSQL codegen surface in Prisma 8
