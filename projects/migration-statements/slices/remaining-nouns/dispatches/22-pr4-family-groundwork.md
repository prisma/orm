# Dispatch 22: family groundwork for rewrites planned with the diff

**Plan:** [`../plan-pr4.md`](../plan-pr4.md) · **Grounding:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/pollyanna-30-context-6ee51c/wip/pr4-grounding.md`, sections 1 and 3 · **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/pollyanna-30-context-6ee51c/wip/wt-pr4` · **Branch:** `tml-3537-value-object-variant-statements` (dispatch 21 is committed there)

Work only inside the worktree. This dispatch changes no behaviour a user sees. It prepares the SQL family so that later dispatches can add JSON rewrites, variant converts and row deletions without copying code. Three entries in `projects/migration-statements/deferred.md` describe the problems; resolve them and remove the entries.

## Items

1. **"Planned with the diff".** Resolve the `deferred.md` entry "Enum value renames are statements the statement planner does not plan".
   - Give the result of `StatementPlanner.plan` (`packages/2-sql-family/9-family/src/core/migrations/statement-planning.ts`) an outcome that says a statement's operations are planned with the diff, instead of `ok([])`.
   - The target then fills in the operation positions, replacing what `withEnumValueOperations` patches on afterwards.
   - Use it for enum value renames and for the dispatch 21 statements: value object field renames, value object member backfills, variant converts.
   - This is family code. Do not change `AppliedMigrationStatement` or any other type in `packages/1-framework`. If you find you must, stop and report it.
2. **Share the stored value helpers.** Resolve "Stored value code is copied in both SQL targets, and the runners read the counted value from the check's parameters":
   - Move `storedValueSubjects`, `storedValueOperationIndexes` and `keepRowsEdit` from the two targets' `stored-value-calls.ts` into the SQL family, with the call classes passed in.
   - Add `rowsHoldingValueFailure({ mark, operationIndex, count })` in the family beside `rowsWithoutValueFailure`.
   - Let the check's mark carry the encoded value to count, so the runners stop reading `step.params[0]`.
3. **`rowsHoldingValue` becomes a list.** Resolve "`rowsHoldingValue` reports one column where its sibling reports a list":
   - Make it a list with one entry per field, counted for each marked removal of the same migration, the failed one first, as `rowsWithoutValueFailure` does.
   - `MigrationRunnerFailureMeta.rowsHoldingValue` is a framework type. Changing it from one entry to a list changes its shape, not its meaning, so it is allowed. Change nothing else in the framework. Update the CLI advice that reads it.

Write a failing test first for every behaviour change. Items 1 and 2 are refactors: the existing enum value tests and journeys must pass unchanged.

## Rules

- Commit after each item, so a crash loses little.
- Never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all`. Run named files with `pnpm test <file>` inside `test/integration`, and journeys with `pnpm test:journeys <file>`. `pnpm test:packages` is allowed.
- Use `mise exec --` for node and pnpm. Never `npx`. Do not write to `/tmp` or any system temp directory. Save slow output under `wip/` in the worktree and read the file. Never use bare `git stash`.
- No comments where the code can say it. No bare `as` casts in production code. No `any`. No file extensions in imports. No backwards-compatibility exports. Framework packages name no family or target.
- No invented nouns: use the names in this brief or in the code. Never hard-wrap Markdown prose.
- Commit with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`. No AI attribution lines (no Co-Authored-By, no "Generated with"). Stage files explicitly.
- Do not push. Do not open a PR.

## Done when

- `pnpm build` is clean; typecheck, lint and `test --coverage` pass in every touched package.
- `lint:deps`, `lint:ratchets` and `check:error-reference` pass.
- These journeys pass: `enum-value-statements*`, `required-field-advice*`.

## Report

Plain English, short sentences: each item and what you did, every file you changed in `packages/1-framework`, the tests that were red first, the checks, anything you could not do and why, and the commits.
