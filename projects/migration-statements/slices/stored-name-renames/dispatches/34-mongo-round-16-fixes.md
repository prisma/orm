# Dispatch 34 (MongoDB): fixes from review round 16 and QA round 8

**Reviews to fix:** `projects/migration-statements/slices/stored-name-renames/reviews/pr2-round-16/code-review.md` (F01 to F04) and `system-design-review.md` (A62; A63 is already done in the PR description). Probes are in that folder. **QA:** `projects/migration-statements/manual-qa-reports/2026-11-25-qa-stored-names-mongo-round-8.md`, findings 28 and 29. **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-494725`. **Branch:** `gandhi-65/tml-3840-mongo-stored-name-renames`. **Tier:** Opus, medium effort.

Keep notes in `wip/mongo-stored-names/d25-progress.md`. The rules of dispatch 28 hold:

- run only the test and journey files you change, one per command;
- change nothing under `packages/1-framework` beyond `3-tooling/cli`;
- no AI attribution in commits;
- do not push;
- you may build.

## Fix

1. **F01.** Re-planning ends, but its cost stays linear only because of `leftOutResult ??=`, and no test fails without it.
   - Add a test that plans a 12-level chain through the planner directly, in well under a second. It must fail with the memo removed.
   - Correct the comment so it says what keeps the re-planning short, not "one level".
2. **F02.** The end-to-end multi-copy test applies pipelines it writes itself. Make it take the copy calls from the route text the planner prints: evaluate the printed calls, as the round-trip test does. Then it fails when a printed call is wrong. Show that it fails with a printed stage broken.
3. **F03.** Give each `rerunText` call site in the runner that no test covers a test, so breaking any one of them fails a test.
4. **F04 and A62.**
   - The error reference states only what is true: which runner stops say that a copy runs again.
   - `bypassValidationRefusal` uses `rerunText` instead of writing the sentence itself.
   - The stops that can follow a copy and still say otherwise either use `rerunText` or have a reason recorded in the notes. These include the create onto an existing collection and the data-transform update failures.
5. **QA 28.** A combined refusal does not end by repeating the second refusal's opening sentence.
6. **QA 29.** The merge route says nothing about documents the target "does not already hold" when it already holds them all. Say what is true for the case, and add a test.

## Done when

- `mise exec -- pnpm build` is clean.
- Typecheck and lint pass in every touched package, `test/integration` included.
- `mise exec -- pnpm lint:deps`, `lint:ratchets`, `lint:docs`, `fixtures:check` and `check:upgrade-coverage --mode pr` pass.
- Every test and journey file you change passes, each run on its own. Each behaviour change is red before the fix.
- `git diff --stat origin/main -- packages/1-framework` lists only files under `3-tooling/cli`.

## Report

Plain English, short:

- per item, what changed and which test was red first;
- the commits;
- each check, with its result.
