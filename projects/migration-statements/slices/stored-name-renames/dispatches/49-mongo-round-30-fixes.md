# Dispatch 49 (MongoDB): fixes from review round 30

**Review:** `projects/migration-statements/slices/stored-name-renames/reviews/pr2-round-30/`. Fix F01 to F05 from `code-review.md`. The design review's A75 is the same finding as F01, and A76 is the same as F02. The probes are in that folder. F06 is the PR description, which the orchestrator fixes.

**QA:** the round 17 wording note on the duplicate hint is the same as F03.

**Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-494725`. **Branch:** `gandhi-65/tml-3840-mongo-stored-name-renames`. **Tier:** Opus, medium effort.

Keep notes in `wip/mongo-stored-names/d37-progress.md`. The rules of dispatch 28 hold:

- run only the test files you change, one per command;
- change nothing under `packages/1-framework` beyond `3-tooling/cli`;
- no AI attribution in commits;
- do not push;
- you may build.

## Fix

1. **F01 and A75.** When two groups of models move into one time-series collection, the planner prints one copy with several `$unionWith` stages. The runner recognises that copy as a pair only if it has a single `$unionWith` stage, so a stop between the copy and its deletes gives no advice. Fix it in whichever of these two ways is simpler and keeps one owner:
   - **Change the runner.** Let it recognise one copy whose `$unionWith` stages each pair with a later `deleteDocuments` that has the same source and filter. The advice then names every delete that has not finished.
   - **Change the planner.** Print one copy per group, each followed by its own delete. Check first that this stays safe on a re-run. Each copy rewrites the whole target, so that may be the heavier choice.

   Whichever you choose, add a live runner test: two groups moving into one time-series collection, stopped between the copy and the deletes, with the advice followed. Each document must end up in the target exactly once.
2. **F02 and A76.** In the catch that attaches the advice, rethrow an `InternalError` before anything else, as the MySQL runner does. Add a unit test.
3. **F03 and the QA note.** The duplicate hint should say to find the doubled documents by grouping the target by `_id` and keeping the `_id`s that appear more than once, for example `[{ $group: { _id: '$_id', n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }]`. It should not point the user to the copy's filter. Update the pinned tests.
4. **F04.** Add tests for the three pairing checks that survive mutation today (M09, M03, M12). Each test must fail under its own mutation.
5. **F05.** The error reference (`docs/reference/error-reference.md`) must describe the new failure:
   - a plain thrown error after the pair becomes `MIGRATION.EXECUTION_FAILED`, with the original error as its cause and the advice attached;
   - the stop advice after a copy and its delete or drop.

## Done when

- `mise exec -- pnpm build` is clean.
- `pnpm api:check` passes.
- Typecheck and lint pass in `@internal/target-mongo` and `test/integration`.
- `lint:deps`, `lint:ratchets` and `lint:docs` pass.
- Every test file you change passes, each run on its own.

## Report

Write plain English and keep it short. Give:

- for each item, what changed and which test failed before the fix;
- for item 1, which way you chose and why;
- the commits;
- each check, with its result.
