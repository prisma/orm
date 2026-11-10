# Slice plan — Statements on the command line, and renames of models and fields

**Spec:** [`spec.md`](./spec.md) · **Linear:** [TML-3475](https://linear.app/prisma-company/issue/TML-3475) · **Branch:** `tml-3475-statement-renames`

Every dispatch runs on Opus. Validation gate unless stated: `pnpm typecheck`, `pnpm --filter <touched packages> lint`, `pnpm --filter <touched packages> test`, `pnpm lint:deps` when imports change, `pnpm fixtures:check` when IR or rendering changes. Never the full integration or package suites locally; run named files.

## Dispatches

### 1 — Salvage the planner substrate from prisma/orm#30570

**Outcome.** Postgres and SQLite carry the working schema shared by the planner and the hand-written facade, destination-driven companion constraint names, foreign-key pairing by own and referenced columns preferring the same referenced table, `OpFactoryCall.toOps`, `SchemaTables`, and the widening reclassification of non-data drops, with every hint, `ConsumedHint`, contract-section and `resolveHints` reference left out. The facade's `renameTable` runs on the working schema, so order-dependent calls compose and re-reading `operations` is safe.

**Builds on.** `main`.

**Hands to.** A working-schema mechanism on both targets that the facades use and the planners will use from dispatch 3; `renameTable` calls that compute companions against the working copy; non-data drops classed `widening`.

**Focus.** Copy mechanism, not history. The scope includes `packages/1-framework/3-tooling/migration/src/migration-base.ts` for the authoring-state reset hook the facade needs, and `examples/prisma7-adoption/test/handover.test.ts` where the reclassification changes an expectation. The shelved branch is `tml-3422-intent-hints-model-rename`; its tests for the working schema, companion renames and classification come over minus the hint cases.

### 2 — Statement grammar and resolver in the framework

**Outcome.** The framework CLI package parses `--rename old:new` values into statements and resolves them against an origin and a destination contract into domain coordinates, with every rule of the slice spec's Grammar and Resolution sections and its three error codes, and the planner input type carries `statements`.

**Builds on.** `main` (independent of dispatch 1).

**Hands to.** `ResolvedMigrationStatement` and the resolver, exported from the CLI package's control API; `statements` on the planner input, empty everywhere it is constructed.

### 3 — Model renames from statements on both SQL planners

**Outcome.** The SQL family maps a resolved model statement to its storage effect, applies it to the working copy in order, the planners emit the table rename and companions ahead of the diff, refuse a non-`managed` target with a `statementRefused` conflict, and the plan reports `appliedStatements` with the family's description text.

**Builds on.** Dispatches 1 and 2.

**Hands to.** The application path every later statement kind reuses; `appliedStatements` on the plan.

### 4 — Column rename operation and field statements

**Outcome.** `renameColumn` exists on the Postgres and SQLite facades and planners with prechecks and postchecks, renames the column's unique and foreign-key constraints to destination names and its indexes to their destination wire names, and a resolved field statement is applied through it; a relation field statement applies with zero operations.

**Builds on.** Dispatch 3.

**Hands to.** Field renames end to end at the planner level.

### 5 — The flag on both commands, the origin contract for `db update`, output and errors

**Outcome.** `migration plan` and `db update` declare `--rename`, parse and resolve statements before planning, fail with the three error codes before anything is planned, `db update` resolves its origin contract from the marker hash through the snapshot store and passes it to the planner, and both commands print `Statements applied` and emit `appliedStatements`. The error reference and the CLI README's two command sections describe the flag, the errors and the output.

**Builds on.** Dispatch 4.

**Hands to.** The user-visible feature on both targets.

### 6 — Journeys, upgrade fragment, subsystem doc

**Outcome.** The slice done conditions hold on Postgres and SQLite through journey tests next to the existing `rename-table-migration` journeys; the re-run of `migration.ts` is byte-identical; the upgrade fragment records the widening reclassification and the new flag; the Migration System subsystem doc has a section on statements and the `@hint(was:)` sentences in it, in the Data Contract doc, ADR 001 and ADR 028 are replaced by a pointer to that section.

**Builds on.** Dispatch 5.

**Hands to.** Slice DoD.

## Open items

- None at planning.
