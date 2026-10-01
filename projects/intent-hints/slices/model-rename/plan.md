# Slice plan — The hint attribute, the contract section, and model renames

**Spec:** [`spec.md`](./spec.md) · **Design:** [`../../design.md`](../../design.md) · **Branch:** `tml-3422-intent-hints-model-rename`

Every dispatch: tests first, red before the change; `pnpm --filter <pkg> typecheck`, `pnpm --filter <pkg> lint`, `pnpm --filter <pkg> test` for each touched package; `pnpm lint:deps` when imports change; commit with `-s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"` and the Co-Authored-By trailer; never `git add -A`; never kill processes by pattern; never stash. Model: Opus for every dispatch (operator override in `drive/calibration/model-tier.md`).

## Dispatches

### 01 — The contract section

- **Outcome:** a `hints` section rides `contract.json` outside every hash: framework `Contract.hints?: JsonObject`; `SqlContractHints` types, `sqlContractHints` accessor, arktype schema and `assertContractHintsConsistent` (items 1, 2, 6) in `@internal/sql-contract`; canonicalization order; emitter `.d.ts` free of it; JSON schema regenerated; `stripContractHints` applied by the snapshot store and the Postgres ledger upsert; the Mongo validator still rejects the key.
- **Rules:** R3.1 to R3.9, R3.10 items 1, 2 and 6, R3.11 (validator half), R3.12, R3.13.
- **Builds on:** nothing.
- **Hands to:** a contract object with a validated `hints` section that every loader accepts and every snapshot writer strips.
- **Gate:** package gates for `@internal/contract`, `@internal/sql-contract`, `@internal/emitter`, `@internal/migration-tools`, `@internal/postgres` adapter, `@internal/mongo-contract`; `pnpm fixtures:check` with no churn; `pnpm --filter @internal/sql-contract-ts schemas:generate` then its drift test.

### 02 — PSL authoring of a model rename hint

- **Outcome:** `@@hint(was: "...")` and `@@hint(deprecated: ...)` parse through a registered spec, every rule in R1.1 to R1.12, R1.14 (`was`), R1.15 to R1.17 and R1.19 produces its exact diagnostic, `collectHints` feeds `ContractDefinition.hints`, and `buildSqlContractFromDefinition` emits the R3.4 section; the storage hash is unchanged by the hint; Mongo, Prisma 7 and Prisma 6 rejection pinned.
- **Rules:** R1.1 to R1.12, R1.14 (`was` clauses), R1.15 to R1.17, R1.19, R2.7, R3.6, R3.11 (interpreter half).
- **Builds on:** 01.
- **Hands to:** an emitted `contract.json` carrying a model `was` hint from PSL.
- **Gate:** package gates for `@internal/psl-parser`, `@internal/sql-contract-psl`, `@internal/sql-contract-ts` (for `ContractDefinition`), `@internal/mongo-contract-psl`, `@internal/sql-contract-prisma7`, `@internal/mongo-contract-prisma6`; the language-server completion and signature-help lists updated and green.

### 03 — TypeScript authoring, the authored-contract capability, and printing

- **Outcome:** `sql({ hint: { was } })` lowers to the same section with the same messages under `CONTRACT.HINT_INVALID`; `validateAuthoredContract` exists on the SQL family instance and `validateLoadedContract` calls it; `contract print` renders `@@hint(was:)`; the `--to` note is in the CLI README.
- **Rules:** R2.1 (`was` arm), R2.3, R2.4, R2.5 (model rules), R3.10 (the capability wiring), R3.14, R3.15 (the `was` rendering), R3.16, R3.17.
- **Builds on:** 02.
- **Hands to:** both authoring surfaces produce identical sections; `contract emit` and `contract print` validate hints.
- **Gate:** package gates for `@internal/sql-contract-ts`, `@internal/framework-components`, `@internal/family-sql`, `@internal/cli`, `@internal/postgres` (print).

### 04 — Resolution in the SQL family

- **Outcome:** `resolveHints` with `HintOrigin`, `ownerOf` on `SchemaOwnership` and the aggregate, the `hintRejected` conflict with `MIGRATION.HINT_CONTRADICTED` and `MIGRATION.HINT_FOREIGN_TABLE`, `ConsumedHint` and `MigrationPlan.consumedHints`, `OpFactoryCall.toOps`; table hints only.
- **Rules:** R4, R5.0 to R5.2, R5.6 to R5.8, R6.3 (the `toOps` addition), R6.5.
- **Builds on:** 01.
- **Hands to:** a pure `resolveHints` the planners call, and the framework types they fill.
- **Gate:** package gates for `@internal/framework-components`, `@internal/family-sql`, `@internal/migration-tools` (aggregate `ownerOf`); error-reference entries for the two codes; `pnpm check:error-reference`.

### 05 — Non-data drops are widening

- **Outcome:** every call R7.0 names is `widening` on Postgres and SQLite, including the SQLite `classifyNodeIssue` change and the two Postgres planner guards; every test and journey that asserted `destructive` for them is corrected; `db update` no longer prompts for them; the upgrade fragment `upgrade-instructions/pending/intent-hints-model-rename/app/instructions.md` records the consent change and the re-emit warning.
- **Rules:** R7.0.
- **Builds on:** nothing (independent of 01 to 04; sequenced here so the planner dispatches inherit it).
- **Hands to:** the classification the planner dispatches rely on for prompt-free renames on SQLite.
- **Gate:** package gates for `@internal/postgres` target, `@internal/sqlite` target, `@internal/cli`; the `db-update-workflows` and `migration-plan-details` journeys; `pnpm check:upgrade-coverage --mode pr --prev $(git rev-parse tml-3421-rename-hints) --head HEAD`.

### 06 — Postgres: working schema, destination-driven companions, facade

- **Outcome:** `WorkingSchema` for Postgres with `renameTableInPostgresSchema` and `apply` for the rename calls; `postgresTableRenameCall` returning a `RenameTableCall` with companions and `toOps`; constraint companions named from the destination (R6.10); `applyTableRename` deleted; the facade's `renameTable` runs on the working schema; the rename-table tests from prisma/orm#30331 pass against the new shape, plus the introspected-origin case.
- **Rules:** R6.0 (Postgres), R6.2, R6.3 (`RenameTableCall`), R6.8, R6.9, R6.10.
- **Builds on:** 04.
- **Hands to:** schema-level rename functions the planner dispatch calls.
- **Gate:** package gates for `@internal/family-sql`, `@internal/postgres` target and adapter (`runner.rename-table.integration.test.ts`).

### 07 — Postgres: planner integration, warning, guard remedy

- **Outcome:** the Postgres planner runs R6.1: resolve, `planHintRenames`, diff on `working.current`; `consumedHints` on the plan; the R6.7 warning; the R9 remedy text; a hinted rename never reaches the case guard; the planned `migration.ts` equals the hand-written one byte for byte and re-emits to the same `ops.json`.
- **Rules:** R6.1, R6.4, R6.6, R6.7, R9.
- **Builds on:** 05, 06.
- **Hands to:** a Postgres plan from a hint.
- **Gate:** `@internal/postgres` target package gates; `hint-renames.test.ts`.

### 08 — SQLite: working schema, facade, planner

- **Outcome:** the SQLite mirror of 06 and 07: `WorkingSchema`, `renameTableInSqliteSchema`, `sqliteTableRenameCall` with index replacement companions, facade on the working schema, planner integration, warning, guard remedy.
- **Rules:** R6.0 to R6.10 as they apply to SQLite; also delete `applyTableRename`, its contract rewriting and the `withEntries` use that dispatch 06 left in place because SQLite still called them.
- **Builds on:** 07 (pattern), 05.
- **Hands to:** a SQLite plan from a hint.
- **Gate:** `@internal/sqlite` target and adapter package gates.

### 09 — CLI reporting and docs

- **Outcome:** `MigrationPlanResult.consumedHints` with rendered text through `describeConsumedHint` on the family instance, the `Hints applied` block, planner warnings forwarded into `MigrationPlanResult.warnings`; the CLI README, the contract-psl README, the prisma-8 skill references and the journey-tests skill updated; the error reference complete.
- **Rules:** R10.1 to R10.3, section 14 (slice 1 items).
- **Builds on:** 07, 08.
- **Hands to:** the user-visible surface of the slice.
- **Gate:** `@internal/cli` and `@internal/framework-components` package gates; `pnpm check:error-reference`.

### 10 — Journeys

- **Outcome:** `hint-rename.e2e.test.ts` (Postgres) and `hint-rename.sqlite.e2e.test.ts` implement the slice done conditions; the journeys README table lists them.
- **Rules:** section 13 journeys, restricted to model renames.
- **Builds on:** 09.
- **Hands to:** the slice DoD evidence.
- **Gate:** `pnpm --filter integration-tests test test/integration/test/cli-journeys/hint-rename.e2e.test.ts` and the SQLite file (never the whole suite locally); `pnpm fixtures:check`.

## Sequence

01 → 02 → 03 → 04 → 05 → 06 → 07 → 08 → 09 → 10. Dispatch 05 is independent and may run before 01 if the implementer is idle.

## Open items

None.
