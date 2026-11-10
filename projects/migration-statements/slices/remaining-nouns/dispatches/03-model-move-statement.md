# Dispatch 3 — `--rename Invoice:billing.Invoice` moves the table

**Slice:** [`../spec.md`](../spec.md) § "What each statement does", Namespaces · **Plan:** [`../plan.md`](../plan.md) · **Branch:** `tml-3537-namespaces` · **Builds on:** dispatch 2 (`setTableSchema`)

## Outcome

A model rename whose namespace changes plans `setTableSchema` on both commands, through the working schema, and the planner's `moveNamespace` refusal is gone. Postgres only; SQLite has no namespaces, so its planner never sees the case.

## What exists

- The resolver already resolves a cross-namespace model rename (`resolve-statements.ts`, `resolveModelRename`).
- `modelRenameStorageEffect` in `packages/2-sql/9-family/src/core/migrations/statement-planning.ts` returns `{ kind: 'moveNamespace', from, to }`, and `#planModel` refuses it with `statementRefused`. Tests pin the refusal in `packages/2-sql/9-family/test/statement-planning.refusals.test.ts` and `packages/3-targets/3-targets/postgres/test/migrations/planner.statements.test.ts`.
- `StatementPlanningTarget` has `renameTableCall`, `renameColumnCall`, `apply`, `tables`. The Postgres target implements it over its working schema (`working-schema.ts`).
- Dispatch 2 added `SetTableSchemaCall` and the `setTableSchema({ schema, table, to })` facade method, with checks, rendering and ordering.

## Do

1. **Tests first**, red before each change:
   - Family: a move statement plans one call through the target and applies it to the working schema; a move that also renames the table (`Invoice` in `public` to `Bill` in `billing`) plans the move and the rename in a defined order, each computed against the working schema as the other left it; a move onto a table that already exists in the destination schema of the origin is refused with a message that names it; a move refused by the control policy is refused as a table rename is.
   - Postgres planner: `--rename Invoice:billing.Invoice` on a contract whose origin has `public.Invoice` and whose destination has `billing.Invoice` plans `createSchema("billing")` if needed, then `setTableSchema`, and no drop or create of the table; a foreign key from another table to `Invoice` plans nothing, because Postgres keeps it pointing at the moved table (dispatch 2 proved this on PGlite); the plan's `appliedStatements` entry points at the move operation; the diff after the working-schema step plans only what else changed.
   - `migration.ts` round trip: the rendered `this.setTableSchema(...)` re-emits the same `ops.json`.
   - Both commands: a `db update` test that moves a model's table on PGlite with the statement and reports no data loss question; a `migration plan` test that writes the package.
2. Add `setTableSchemaCall` (or the name that fits the existing ones) to `StatementPlanningTarget`, implement it on the Postgres target over the working schema, and make the SQLite target refuse it in the one place a namespace change can never arise there (say in the report what you did).
3. In `#planModel`, handle `moveNamespace`: policy check as for a rename; the destination-exists check; the call; record the move so later statements name the table by its new coordinate (as `#renamedTables` does for renames).
4. Delete the `moveNamespace` refusal and its tests; update the error reference entry for `MIGRATION.PLANNING_FAILED` that lists it.
5. **The unbound namespace.** A Postgres contract with `namespace unbound { }` is late-bound (ADR 223, `interpreter.ts` around line 264). Decide from the code what a move into or out of it means, and refuse it with a clear message if the planner cannot place it. Say in the report which you chose and why.
6. Docs: Migration System § Statements, "Rename limits in this release": remove the move limit; describe the move under "Application" next to the table rename.

## Do not

- Do not touch namespace renames or deletes; that is dispatch 4.
- Do not change the resolver's grammar.

## Rules

- Never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all`. Only named files inside `test/integration` with `pnpm test <file>`.
- Use the shell's Node and `pnpm`. Never `npx`.
- No comments where the code can say it; no bare `as` casts in production code; no file extensions in imports; no backwards-compatibility exports.
- Commit with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`. No AI attribution lines. Stage files explicitly.
- Do not push. Do not open a PR.
- Save slow command output under `wip/` and read the file.

## Done when

- Typecheck; lint and tests with coverage in the SQL family, the Postgres target, the SQLite target and the CLI; `lint:deps`; `fixtures:check`; `check:error-reference`; `lint:throws`; `lint:casts`.
- Inside `test/integration`, every file that runs `migration plan` or `db update` with `--rename`, by name: `git grep -l -- '--rename' test | sort`, plus `test/cli-journeys/rename-statements*` if they exist.

## Report

Plain English, short sentences: what the planner does for a move, the order of a move plus rename, the unbound-namespace decision, the test that was red first for each change, the gates run with results, anything the brief did not cover, and the commits.
