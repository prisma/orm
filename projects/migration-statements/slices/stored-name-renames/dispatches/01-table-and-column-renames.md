# Dispatch 1: table and column renames planned from the contracts

**Slice plan:** `projects/migration-statements/slices/stored-name-renames/plan-pr1.md`, row 1 · **Spec:** `projects/migration-statements/slices/stored-name-renames/spec.md` (read all of it first) · **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-5072cc` · **Branch:** `tml-3839-stored-name-renames` · **Tier:** mid (Opus, medium effort)

Work only inside the worktree. Keep notes in `wip/stored-name-renames/out/d1-progress.md` and update them as you go, so a stopped run can be picked up.

## Inputs

- The spec, sections "The rule", "Storage is renamed only when all of it moves", "What a pair with the same coordinate plans", "Where the rule does not apply", "Refused in this slice", "Order".
- `wip/stored-name-renames/code-map.md` sections 1, 2, 4, 5: where today's code is. It is a lead; read the code.
- The two design reviews under `projects/migration-statements/slices/stored-name-renames/reviews/design/`, findings A01, A02, A04, A05, P01, P03, P04, P05, P07. The probe in `wip/stored-name-renames/pe-probes/` shows the shared-storage defect.
- `docs/architecture docs/subsystems/7. Migration System.md` § Statements, ADR 264, ADR 224 (control policy).
- `drive/calibration/failure-modes.md` F5, F13, F26, F45, F49.

## Outcome

On PostgreSQL and SQLite, when the plan is built from an origin contract and a destination contract (the `migration plan` path), a model or field with the same coordinate in both contracts whose table or column differs is planned as a rename, with no question, **such that the planner pairs objects only on what the two contracts state and never moves data that belongs to an object outside the pair**.

In detail:

1. **Representation.** Inside the SQL family, rename planning takes renames that each carry the statement that asked for it, or none. Do not build a `Resolved*Statement` object for a pair with the same coordinate. One function builds a refusal: with a statement it is today's `statementRefused` conflict, unchanged; without one it is a conflict of kind `unsupportedOperation` with no `refusedStatement`, and text that names the contract change and never says "statement". Every existing site that sets `refusedStatement` or prints "this statement" either goes through it or cannot be reached without a statement; list each site and which it is in your notes. Do not invent a noun for the new kind of pair in type names or messages; use the code's existing words.
2. **Pairs.** Models: same namespace and name in both contracts, where no model rename statement already pairs either side. Fields: same field name within a paired model, whichever way the model was paired, where no field rename statement already pairs either side.
3. **All of it moves.** A table is renamed only when every origin model stored in the old table is paired with a destination model stored in the new table, and no destination model is stored in the old table. Same for a column and the fields mapped to it. One rename per table or column. When the condition fails for a pair with the same coordinate, no rename is planned and the plan is today's. When it fails for a statement, the statement is refused, saying the storage is shared with the models (or fields) named and that moving one of them out is a data migration to write by hand.
4. **Managed on both sides.** A pair with the same coordinate is made only when the control policy is `managed` for the old table under the origin contract and for the new table under the destination contract. Otherwise no rename, and the plan is today's.
5. **One check over all renames**, statement and not, before any is applied, comparing names as the target does (use the working schema's own lookup, such as `tablesNamed` and `columnsNamed`). A rename without a statement is refused when its new name is held in the origin by anything but its own source, when another rename has the same new name, or when its old or new name chains with a statement rename in either direction. Statement renames among themselves behave as today. Each refusal names the coordinates and stored names, says what the plan would misread, and gives the route: two steps through a stored name nothing uses, each its own plan.
6. **Order.** Namespace statements; table renames without a statement; the user's statements in the order given; column renames without a statement.
7. **After the rename.** Questions about a renamed table or column are named by the origin model and field (the `origins()` mechanism). A changed type or nullability on a renamed column plans as an alteration. `--delete User.name` on a model whose table was renamed answers the column drop. The rename does not appear in `appliedStatements`. `migration.ts` renders the same facade calls a statement renders, and re-running it reproduces `ops.json`.
8. **Removed.** The field-statement refusal "the model's table changes ... and no statement renames the table" goes, with its tests rewritten to show the plan.

## Not in this dispatch

- The live-database rows of the spec's `db update` table (dispatch 2). Do not break `db update`: when the working schema lacks the old name, plan no rename for that pair, so today's behaviour holds until dispatch 2.
- Enum stored values (dispatch 3).
- CLI text, journeys, docs, the ADR, the upgrade fragment (dispatches 4 and 5). If a journey fails because of your change, list it in your report with the failure; do not rewrite it.
- MySQL. It does not call the family's rename planning. Do not change it.

## Rules

- Tests first: each behaviour has a test that fails before the change. A test of a refusal asserts the whole conflict (kind, summary, why, and that `refusedStatement` is absent). A test of a plan asserts the whole list of operations.
- Change nothing in `packages/1-framework`. If the design needs it, stop and report.
- Do not branch on the target. Target differences go through the target's existing planning interface.
- Never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all`. Run named files with `pnpm test <file>` inside the package or `test/integration`. `pnpm build` is the full build; never build one package.
- Use `mise exec --` for node and pnpm. Never `npx`. Never write to `/tmp`. Never bare `git stash`. No destructive git (no reset, rebase, amend, checkout of files you did not change, clean) without asking me first.
- No comments where the code can say it. No bare `as` in production code. No `any`. No file extensions in imports. Never hard-wrap Markdown prose.
- Do not write guards or tests for inputs the public API cannot produce.
- Commit as you go with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`. Message form: `TML-3839: <sentence saying what is now true>`. No AI attribution lines (no Co-Authored-By, no "Generated with"). Stage files explicitly. Do not push. Do not stage anything under `wip/`.

## Done when

- `mise exec -- pnpm build` and `pnpm fixtures:check` are clean.
- Typecheck, lint and `pnpm test --coverage` pass in the SQL family package and the PostgreSQL and SQLite target packages.
- `pnpm lint:deps` and `pnpm lint:ratchets` pass.
- Tests exist and pass for: a model `@@map` change; a field `@map` change; both together; a `@@map` change with a field rename statement; with a type change; with `--delete` of a field; a model renamed by statement whose field changes `@map` only; the base of single-table variants changing `@@map` (one rename); a single-table variant moving to its own table and back (no rename, no row of another model moves); two variant fields sharing a column with one changing `@map`; `--rename Bug:Defect` on shared storage (refused); swap, chain, takeover and merge for tables and for columns; a chain with a statement in both directions for tables and for columns; a name freed by a rename and taken by a new model or field (planned); names differing only in case on SQLite; a table not `managed` on either side; no origin contract (today's plan).
- `git diff --stat origin/main -- packages/1-framework` is empty.

## Report

Plain English, short: what is now true; the tests that were red first; every `refusedStatement` site and its disposition; the journeys or other tests outside the three packages that now fail and why; anything in the spec the code made you doubt; the commits; the checks you ran with their results.
