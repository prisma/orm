# Dispatch 33 (MongoDB): fixes from review round 15 and QA round 7

**Reviews to fix:** `projects/migration-statements/slices/stored-name-renames/reviews/pr2-round-15/code-review.md` (F01 to F03, and the untested `nested` guard) and `system-design-review.md` (A59 to A61). Probes are in that folder. **QA:** `projects/migration-statements/manual-qa-reports/2026-11-25-qa-stored-names-mongo-round-7.md`, findings 24 to 27. **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-494725`. **Branch:** `gandhi-65/tml-3840-mongo-stored-name-renames`. **Tier:** Opus, medium effort.

Keep notes in `wip/mongo-stored-names/d24-progress.md`. The rules of dispatch 28 hold:

- run only the test and journey files you change, one per command;
- change nothing under `packages/1-framework` beyond `3-tooling/cli`;
- no AI attribution in commits;
- do not push;
- you may build.

## Fix

1. **F01 and A59.** When one group needs a hand-written migration, the route builds every group's consequence with `askedText`. That wrongly says a leave-behind group's data is asked about and deleted; in fact the model is removed without a question, and its documents stay where the other model reads them.
   - Build each group's consequence once, as the planned path does, and use it in both paths.
   - Add a planner test with two groups of different kinds: one leave-behind, one merge or variant leaving its base collection (probe MIXED). Red first.
2. **F02.** `run` returns one query plan, so a move with several copies needs one `dataTransform` per copy, and `deleteDocuments` is an operation of its own.
   - Print one `dataTransform` per copy.
   - Count `dataTransform`s correctly in every sentence. The two-move sentence counts copies, not moves (probe MULTICOPY needs three).
   - Add a planner test, and follow a multi-copy route to the end in `runner-document-moves.test.ts`. Red first.
3. **A60.** Use `rerunText` at every runner stop that says what a re-run does, so none says "operations that already ran are skipped" where a copy with no check can run again. Add a test for one more stop besides the validator check. Red first.
4. **A61.** Compute the plan without the refused statements once, lazily, and derive both the route text and `leftOutRefusals()` from it, so neither depends on the other having run.
5. **The `nested` guard in `planWithout`.** Either a test fails when it is removed, or it is deleted as not needed. Say which.
6. **QA 24.** The printed copy example keeps its indentation.
7. **QA 25.** Show "run the file with node" only where the user has to run it: after writing `migration.ts` for `migration plan`, not for `db update`.
8. **QA 27.** Shorten the two-collection "leave out" paragraph.
9. **F03 and QA 26: record, do not fix.** The CLI's own statement resolver, in the framework CLI package, refuses a field statement given without its model statement before planning, and sends the user back one step. The printed route itself is right, and changing how the resolver treats field statements is outside this pull request. Record it in `projects/migration-statements/deferred.md`, with:
   - the case;
   - the text the CLI prints;
   - why it is deferred.

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
