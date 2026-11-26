# Dispatch 1: the space, and applying it below the command line

**State on 2026-11-26: built and reviewed once; a fix round for the review's findings is in progress.**

## What was built

- `ControlTargetDescriptor.contractSpace`, the constant `PRISMA_TABLES_SPACE_ID = '_prisma'`, and `applyInstalledContractSpace` in `packages/1-framework/3-tooling/migration/src/apply-installed-contract-space.ts`, exported from the `spaces` entry point.
- The PostgreSQL target package carries the space: `src/contract.prisma`, the emitted contract, the first migration `migrations/20261126T1200_create_prisma_tables/` and `migrations/refs/head.json`. The contract and a new migration are produced through `packages/3-targets/postgres/2-adapter/prisma-tables.config.ts` (`pnpm emit:prisma-tables`), because the adapter depends on the target and not the other way round.
- The PostgreSQL adapter reads and writes schema `_prisma`. The runner and `db sign` no longer create the tables on PostgreSQL. SQLite, MySQL, MariaDB and MongoDB are unchanged.
- Tests: seven unit tests of the function, five on the space's consistency in the target package, and tests against a real PostgreSQL database for a fresh database, the release-candidate form, a missing column, both schemas present, and a second run.

## Facts found

- PSL expresses all of the tables. The emitted contract also lists an empty `public` namespace, which the contract builder always adds.
- PostgreSQL's tables are byte-identical between `v8.0.0-rc.1` and today.
- Earlier forms are all from before `rc.1`. Before 2026-07-13 the ledger had `contract_json_before` and `contract_json_after` and there was no `contract` table; before that the marker was one row keyed by `id`. The column checks tolerate extra columns, so the July form passes and gains the `contract` table, and the single-row form stops with the error.
- The emitted `contract.d.ts` contains the column default `'app'`, which the lint for bare `'app'` literals rejected. That lint now skips emitted contract files.

## Review findings and what was decided

1. **An earlier release could not run on a database a later release in the same major had brought further.** Fixed: when the row's hash is not in the installed graph but the installed head is in the space's ledger, the database is ahead and nothing is applied.
2. **The rename needs ownership of the old schema,** which creating tables if absent never needed. Fixed with a precheck that says which role must run the command.
3. **Nothing kept the created tables, the column checks and the contract in agreement.** Fixed with a test that verifies the created schema strictly against the contract, and cases for a database that was only signed, a wrong type, a wrong nullability, and stored contracts surviving the rename.
4. **The runner could run a user's space before Prisma's tables exist.** Fixed: the PostgreSQL runner refuses, before any operation, when the tables are missing and the space is not `_prisma`.
5. **Two commands starting at the same moment write the `_prisma` ledger row twice.** Accepted. The lock covers the rename and the data stays correct; the second row is in a space the user is not shown.
6. Smaller: clearer column-check messages, an internal error for a package that cannot reach its own head, scripts that dropped only the old schema, doc comments, and the error reference.

## For dispatch 2

- Call `applyInstalledContractSpace({ spaceId: PRISMA_TABLES_SPACE_ID, contractSpace: target.contractSpace, driver, familyInstance, migrations: target.migrations, frameworkComponents })` before the first read in `db init`, `db update`, `db sign` and `db migrate`.
- `_prisma` is not a valid folder name for a space, so it stays out of anything that writes `migrations/<space>/`.
- Reads of all marker and ledger rows now include `_prisma` rows; the checks for rows of undeclared spaces must count it as declared.
- About 35 files under `test/integration` still name `prisma_contract`.
