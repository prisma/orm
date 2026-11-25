# Dispatch 36 (MongoDB): fixes from review round 18

**Reviews to fix:** `projects/migration-statements/slices/stored-name-renames/reviews/pr2-round-18/code-review.md` (F01, F02) and `system-design-review.md` (A65, which is the same as F02). **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-494725`. **Branch:** `gandhi-65/tml-3840-mongo-stored-name-renames`. **Tier:** Opus, medium effort.

Keep notes in `wip/mongo-stored-names/d27-progress.md`. The rules of dispatch 28 hold:

- run only the test and journey files you change, one per command;
- change nothing under `packages/1-framework` beyond `3-tooling/cli`;
- no AI attribution in commits;
- do not push;
- you may build.

## Fix

1. **F01.** The sentence `UPDATE_RUNS_AGAIN` in `mongo-runner.ts` says that a re-run of a data-transform update that stopped part way goes over the documents it already changed. It also tells the user to restore them. That is false for the updates the planner writes for `--convert` and `--backfill`: their filter and check select only the documents still to change.
   - Make the sentence depend on what decides it: whether the transform's filter or check excludes the documents it already changed. Most likely that is whether the data transform has a check. Find the rule that is true and use it.
   - For an update whose filter leaves out the documents it already changed, say that a re-run changes only the rest.
   - Fix `docs/reference/error-reference.md` to match.
   - Correct the two assertions in `runner-field-casts.test.ts`.
   - Add a live runner test of a partial `--convert` re-run: it stops part way, the bad value is fixed, it runs again, and each document is converted once.
   - Keep a test of a hand-written update with no such filter, which keeps the "runs again over the documents it already changed" sentence.
   - Each red first.
2. **F02 and A65.** Move `UPDATE_RUNS_AGAIN` so the doc comment of `rerunText` sits directly above `rerunText`.

## Done when

- `mise exec -- pnpm build` is clean.
- Typecheck and lint pass in every touched package, `test/integration` included.
- `mise exec -- pnpm lint:deps`, `lint:ratchets`, `lint:docs`, `fixtures:check` and `check:upgrade-coverage --mode pr` pass.
- Every test file you change passes, each run on its own.
- `git diff --stat origin/main -- packages/1-framework` lists only files under `3-tooling/cli`.

## Report

Plain English, short:

- per item, what changed and which test was red first;
- the commits;
- each check, with its result.
