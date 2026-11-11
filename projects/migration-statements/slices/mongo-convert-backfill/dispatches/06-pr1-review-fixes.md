# Dispatch 6: fixes from the dispatch 5 review, and merging main

**Plan:** [`../plan-pr1.md`](../plan-pr1.md) · **Review:** `../reviews/code-review.md`, dispatch 5 · **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/pollyanna-30-context-6ee51c/wip/wt-4b` · **Branch:** `tml-3538-mongo-value-object-statements`

Work only inside the worktree. Leave review finding 1 (`migration plan` and planner warnings) and the no-origin question wording alone; both wait for Will.

## Fixes

Each with a test that fails without the fix, where code changes.

1. **Variants in the document check's touched fields.** `fieldsTouched` (`mongo-runner.ts`, around lines 254-286) merges all variants' `required` lists and properties, so it misses a field one variant newly requires when another already required it, and can report a type change that did not happen. Compare each variant's shape separately. Add a test with variants.
2. **Upgrade fragment.** In `upgrade-instructions/pending/mongo-validator-changes-check-documents/app/`, the third change's body says "Nothing to do.", which the fragment rules forbid. Say the action: plan with `--backfill` to write your own value, which a field under a unique index needs.
3. **ADR 188 example.** It uses `AGE_NOT_INT`, which nothing defines. Write the real `$expr` filter the planner writes.
4. **Scalar to value object.** A model field that changes between a scalar and a value object gets no warning. Warn about it with the other `documentsNotRewritten` cases in `untouchedChange`.

## Merge main

`origin/main` has moved to 8.0.0-rc.23, and `check:upgrade-coverage` fails until it is merged. Run `git fetch origin main` and `git merge origin/main`. Never rebase, amend or force-push. Resolve conflicts, then run `pnpm install --frozen-lockfile` and `pnpm build`.

## Rules

As in the earlier briefs: nothing in `packages/1-framework` apart from prose; never the full integration suites; `mise exec --`; no `/tmp`; no bare `git stash`; no comments where code can say it; no bare `as`; no invented nouns; no hard-wrapped Markdown; commit with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"` and no AI attribution; stage files explicitly; do not push.

## Done when

- The checks in the plan's "Checks for every dispatch" pass after the merge, including `check:upgrade-coverage`, with every MongoDB journey passing.

## Report

Plain English, short sentences: each fix, the merge (conflicts and how you resolved them), the tests that were red first, the checks, and the commits.
