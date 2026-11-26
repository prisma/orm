# Dispatch 1: the space, and applying it below the command line

**State on 2026-11-26: paused part-way, at the operator's request to free the machine. Resume from "Still to do".**

## Done

- `5fb74d822a`, finished. `ControlTargetDescriptor.contractSpace`, the constant `PRISMA_TABLES_SPACE_ID = '_prisma'`, and `applyInstalledContractSpace` in `packages/1-framework/3-tooling/migration/src/apply-installed-contract-space.ts`, exported from the `spaces` entry point. `reconstructGraph`, `verifyMigrationHash`, `resolveRecordedPath` and `requireHeadRef` take packages without a folder path. A new error, `MIGRATION.INSTALLED_SPACE_UNREACHABLE`, for a row at a contract the installed migrations never pass through. Seven unit tests, seen to fail first.
- `4640d03426`, work in progress, committed without the lint hook. The PostgreSQL target package has `src/contract.prisma`, the emitted contract, the first migration `migrations/20261126T1200_create_prisma_tables/`, `migrations/refs/head.json`, and `contractSpace` on the descriptor. `test/prisma-tables-space.test.ts` has five cases; four pass, and the fifth needs one build so the new constant is visible in the framework's built output.

## Still to do

1. Remove `ensureControlTables` and its call from `packages/3-targets/postgres/1-target/src/core/migrations/runner.ts`.
2. In `packages/3-targets/postgres/2-adapter/src/core/marker-ledger.ts` and `control-adapter.ts`: the schema becomes `_prisma` in the table handles, the three `information_schema` lookups and the two location constants. `bootstrapControlTableQueries()` and `bootstrapSignMarkerQueries()` return an empty list on PostgreSQL, which keeps the shared interface for SQLite and MySQL.
3. Delete `src/contract-free/control-bootstrap.ts` and its two exports, then update `packages/9-public/@prisma/orm-target-postgres/api.txt` for that package only.
4. Tests the removal breaks: `2-adapter/test/migrations/fixtures/runner-fixtures.ts`, `marker-ledger-writes.integration.test.ts` and `runtime-marker-read.integration.test.ts` call `applyInstalledContractSpace`; `marker-table-ddl.test.ts` is deleted. `test/integration/test/postgres-bootstrap.ts`, used by six integration test files, needs the same change, here or in dispatch 2.
5. The four tests against a real PostgreSQL database (fresh, release-candidate form, older form, second run), in a new `2-adapter/test/migrations/prisma-tables-space.integration.test.ts`, with the release-candidate statements as text in a fixture. The exact statements today's code renders are saved in the gitignored `wip/own-space/bootstrap-ddl.txt`.
6. One build, the touched test files, typecheck and lint for the target and adapter packages, the dependency check once, and a normal commit so the hook formats the work-in-progress files.

## Facts found

- PSL expresses all of it: the namespace `_prisma`, a `jsonb` default of `{}`, a `text[]` default of the empty list, an auto-incrementing 8-byte integer and `timestamptz` defaulting to `now()`. The emitted contract also lists an empty `public` namespace.
- PostgreSQL's tables are byte-identical between `v8.0.0-rc.1` and today.
- Earlier forms are all from before `rc.1`. Before 2026-07-13 the ledger had `contract_json_before` and `contract_json_after` and there was no `contract` table; before that the marker was one row keyed by `id`. The column checks tolerate extra columns, so the July form passes and gains the `contract` table, and the single-row form stops with the error.
- The first migration has eight operations: a conditional rename (skipped when `prisma_contract` does not exist; its precheck fails when both schemas exist), create the schema, create each of the three tables, and one check-only step per table with a precheck per column.

## Open, for the orchestrator

- **Where the authoring config lives.** The package layout wants a `prisma.config.ts` at the package root, and a config must name the adapter, but the PostgreSQL adapter depends on the target package, so the target cannot depend on the adapter. The contract was emitted through a temporary untracked config, `packages/3-extensions/supabase/wip-own-space.config.ts`, which must be deleted or replaced by a decided home.
- **The error text has no address.** It says "the upgrade instructions of Prisma 8 say what to do" until dispatch 3 writes the page.
- **Decided by the implementer, to confirm in review:** the phase's policy allows every operation class, since the user's policies do not govern this space; a corrupt package or an unsatisfiable invariant is an internal error; the target id comes from the driver.
