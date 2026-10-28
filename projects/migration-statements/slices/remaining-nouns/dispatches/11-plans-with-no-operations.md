# Dispatch 11 — a plan with no operations is written and applied

**Plan:** [`../plan-pr3.md`](../plan-pr3.md) · **ADR:** ADR 309, "Why every change is an operation" · **Grounding:** `wip/pr3-grounding.md` § F · **Branch:** `tml-3537-value-objects-storage`

## Outcome

When the storage hash changes but the planner produces no operation, `migration plan` writes the package with no operations instead of refusing, and says so, naming what changed. `db migrate` applies it by moving the marker to the new hash. `db update` does the same. This holds on Postgres, SQLite and MongoDB. Will ruled on 2026-10-21 that migrations are expected to have operations, but edge cases will happen, and the system must handle them, not refuse them.

## What the grounding found

- `migration plan` refuses at `migration-plan.ts` (around line 215, `errorPlanProducedNoOperations`, guarded by `noOperationsExpected`).
- The Postgres runner already moves the marker for a migration with no operations between two different hashes. The SQLite and MongoDB runners and `db update` were not checked.
- The integrity check refuses a migration whose start and end hash are equal unless it has a `data` operation (`check-integrity.ts`); that rule stays, since this dispatch is about two different hashes.

## Do

1. **Tests first, red before each change:** `migration plan` with a changed storage hash and no operations writes the package (`ops.json` `[]`, `migration.json` with both hashes) and prints that the plan has no operations and which storage entities changed; `db migrate` applies it and the marker holds the new hash, on PGlite, SQLite and mongodb-memory-server; `db update` does the same; `db verify` is clean afterwards. To make a storage change with no operation today, use a change the planner does not turn into DDL on that target (find one per target from the code, for example a SQLite value-set change); say which you used.
2. Remove the refusal for this case. Keep `errorPlanProducedNoOperations` only if another case still needs it; if none does, delete it and its error-reference entry.
3. Name what changed: compare the two contracts' storage and list the entity coordinates that differ, in the message and the `--json` output. Reuse an existing comparison if one exists.
4. Docs: Migration System (the `migration plan` emission cases table and the no-operations rule), the error reference, the CLI README.

## Do not

- Do not change how the planner plans anything else.
- Do not touch value objects or discriminators; that is the rest of PR 3.

## Rules

- Never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all`. Only named files inside `test/integration` with `pnpm test <file>`; journeys with `pnpm test:journeys <file>`.
- Use the shell's Node and `pnpm`. Never `npx`.
- No comments where the code can say it; no bare `as` casts in production code; no file extensions in imports; framework packages name no family or target.
- Commit with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`. No AI attribution lines. Stage files explicitly.
- Do not push. Do not open a PR.
- Save slow command output under `wip/` and read the file. The machine may be loaded.

## Done when

- Typecheck; lint and `test --coverage` in the CLI, the migration package, and the Postgres, SQLite and MongoDB targets; `lint:deps`; `lint:ratchets`; `check:error-reference`.
- Every integration file that mentions `errorPlanProducedNoOperations`, `PLAN_PRODUCED_NO_OPERATIONS` or "no operations", by name.

## Report

Plain English, short sentences: the change per command and target, the message and JSON shape, the storage change used per target in tests, the test that was red first for each change, the gates, and the commits.
