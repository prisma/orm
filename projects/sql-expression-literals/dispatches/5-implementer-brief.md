# Brief: slice 5 — migration files write `sql` values (TML-3297)

You work in the git worktree at the current directory, on local branch `l65-5`, made from `main` at `24258f35e7`; it will be pushed as `tml-3297-migration-sql-values`. Install and build have run. Stay inside this worktree; no `/tmp`; scratch and logs under `wip/5/`. Run node, pnpm and git through `mise exec --`. The machine is loaded: run long commands in the background with a log, then read the log.

**Never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all` in full.** `pnpm test:packages` is allowed. In `test/integration`, run only the files you change or name below, with `mise exec -- pnpm --filter integration-tests test <path>`.

## What the slice does

A generated `migration.ts` writes each user or contract SQL text as a `` sql`...` `` template when the tag reads it back unchanged, including multi-line text, and imports `sql` from the target's migration module. The migration functions accept a `sql` value or a string; the string form stays, because committed files use it and the generator writes one whenever a template cannot hold the text unchanged. Rendered SQL and `ops.json` do not change.

## Read first

- `projects/sql-expression-literals/design.md` section 17 (17.1, 17.2). It was checked against the code on 2026-10-08 and corrected; follow it exactly. Section 16 describes slice 4, which this builds on.
- `projects/sql-expression-literals/plan.md`, "Slice 5" (tests) and "Done conditions for every slice".
- ADR 195 (`docs/architecture docs/adrs/ADR 195 - Planner IR with two renderers.md`), ADR 268, and the Migration System subsystem doc sections "Planner IR" and "Opaque SQL in DDL".
- `packages/2-sql/1-core/contract/src/sql-expression.ts` (slice 3): `SqlExpression`, `sql`, `readSqlExpression`, `requireSqlExpression`.

If the code disagrees with the design in behaviour or in a type the design depends on, stop and write it to your report; do not decide it. A file or line that moved is fine: follow it.

## Part 1: migration functions accept both forms (design 17.1)

`MigrationSqlText` and `sqlTextOf` in `packages/2-sql/4-lanes/relational-core/src/contract-free/column.ts`; `fn` and `checkExpression`; `PostgresMigration.createIndex`, `addCheckConstraint`, `createRlsPolicy`, `alterColumnType`; SQLite `addColumn` and `recreateTable` (the function default of a `SqliteColumnSpec`); `export { sql } from '@internal/sql-contract/sql-expression'` in both targets' `src/exports/migration.ts`. Stored option types stay strings. Commit.

## Part 2: the renderer prints `sql` values (design 17.2)

`renderTaggedTemplateSource` in framework-components `shared/tagged-literal.ts`, exported from `exports/authoring.ts`, with every fallback 17.2 step 1 lists. The listed slice 4 sites switch to it; SQLite `renderPostcheck` does not. Each call's `importRequirements()` adds the `sql` import when a text it renders uses the tag. Commit.

## Tests

Every test in plan.md "Slice 5", including the ones added on 2026-10-08: a migration file written with `sql` values runs and produces the same `ops.json` as the string form (Postgres and SQLite), the SQLite postcheck stays a string, the fallbacks, and `sqlTextOf` with a value from another installed copy. Each new test must fail when the behaviour it covers is removed: plant the defect, run, restore, and keep the log. Update the existing exact-output render tests to the new output, reading each changed expectation to confirm it is right (for example `` fn(sql`now()`) ``).

## Do not touch

Docs, ADRs, the error reference, upgrade fragments and `projects/` files: the orchestrator writes them. Do not regenerate committed example migrations (`migration.ts` files); `pnpm migrations:regen:examples` must show no diff.

## Verify

`pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm lint:deps`, `pnpm lint:casts`, `pnpm lint:throws`, `pnpm check:error-reference`, `pnpm lint:framework-vocabulary`, `pnpm fixtures:check`, `pnpm test:scripts`, `pnpm test:packages` (the three tarball tests fail on a known registry refusal; report, do not fix), `pnpm migrations:regen:examples` (no diff). In `test/integration`: `test/planner-golden` and every file you change. After committing: `pnpm check:upgrade-coverage --mode pr --prev "$(git merge-base origin/main HEAD)" --head HEAD`; if it asks for an upgrade declaration, report what it says and leave the fragment to the orchestrator.

## Commits

`mise exec -- git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`. Stage files explicitly, never `git add -A`. No AI attribution lines. Never amend, rebase, squash or force-push. Do not push. Do not switch branches. Do not commit this brief.

## Report

Plain English, short sentences: what you built in each part, any place the code disagreed with the design, the planted-defect evidence for each new test (log paths), every changed render expectation in one line each, every verification result with its log path, and anything you could not do.
