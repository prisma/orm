# Dispatch 32: fixes from review round 4

**Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/pollyanna-30-context-6ee51c/wip/wt-pr4` · **Branch:** `tml-3537-value-object-variant-statements` · **Inputs:** the "Round 4" sections of `projects/migration-statements/slices/remaining-nouns/reviews/pr4/system-design-review.md` and `code-review.md`. Read both first.

Work only inside the worktree. Write a failing test first for every behaviour change.

1. **`migration plan` refuses at once without `--backfill`.** Dispatch 31 made the refusal wait until the lost-field question is answered by carrying it inside `UnfilledValue` and a rejected operation. A placeholder value is not meant to carry a planning refusal, so remove that:
   - Remove `UnfilledValue.refusal`, `refusedFillOperation` in both targets, `PlannerSuccess.refusal` and the refusal branch in `migration-plan.ts`.
   - When a value object gains a required field with no `--backfill`, `migration plan` refuses at once in every case, with the same conflict as when no field was lost. When the value object also lost a field that no statement renames, the advice offers `--rename` first, then `--backfill`, and says that `--delete` on the lost field still needs `--backfill` for the new one. It lists every column and path.
   - `db update` is unchanged: it asks about the lost field and fills a temporary value.
   - Keep the `runPlannerLeg` fix that rethrows a rejection that is not a placeholder. Add a test that an unknown rejection next to a placeholder is thrown, not dropped.
   - Change journey B3 on both targets to match: the refusal names `--rename` and `--backfill`; `--rename` plans the rename; `--delete` plus `--backfill`, fill, `node migration.ts`, `db migrate` and an empty later plan.
   - Update the Migration System doc, the error reference, the CLI README, the `prisma-8` skill reference and `wip/pr4-description.md`.
2. **The `--delete` note** (`newRequiredFieldNote`) does not tell the user to add `--backfill` when the run already passes it, and names every new required field.
3. **The `db migrate` scanner's known misses.** List them in the error reference next to the helper-file case: a regular expression literal holding a quote or backtick before the call, a destructured or reassigned `placeholder`, a class method named `placeholder`, and a parameter that shadows the import. Do not grow the scanner.
4. **The orphaned doc comment** above `newRequiredFieldNote` goes back above `dataLossQuestion`.

## Rules

- Commit after each item, so a crash loses little.
- In `packages/1-framework`, change only CLI code. Change no framework type and add no field to one. If you find you must, stop and report it.
- Never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all`. Run named files with `pnpm test <file>` inside `test/integration`, and journeys with `pnpm test:journeys <file>`. `pnpm test:packages` is allowed.
- Use `mise exec --` for node and pnpm. Never `npx`. Do not write to `/tmp` or any system temp directory. Save slow output under `wip/` in the worktree and read the file. Never use bare `git stash`.
- No comments where the code can say it. No bare `as` casts in production code. No `any`. No file extensions in imports. No backwards-compatibility exports. Don't branch on target.
- No invented nouns. Never hard-wrap Markdown prose.
- Commit with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`. No AI attribution lines (no Co-Authored-By, no "Generated with"). Stage files explicitly. Never amend, rebase or force-push.
- Do not push. Do not open a PR.

## Done when

- `pnpm build` and `fixtures:check` are clean; typecheck, lint and `test --coverage` pass in every touched package.
- `lint:deps`, `lint:ratchets`, `check:error-reference` and `check:upgrade-coverage` pass.
- These journeys pass: `enum-value-statements*`, `value-object-checks`, `plans-with-no-operations*`, `variant-statements*`, `required-field-advice*`, `value-object-backfill*`, `value-object-statements*`, `convert-backfill*`, `data-transform-strategies`, `invariant-routing`.

## Report

Plain English, short sentences: each item and what you did, the tests that were red first, the checks, anything you could not do and why, and the commits.
