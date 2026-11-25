# Dispatch 37 (MongoDB): the test gap from review round 19

**Review:** `projects/migration-statements/slices/stored-name-renames/reviews/pr2-round-19/code-review.md`, F01. Its mutation logs are in that folder. **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-494725`. **Branch:** `gandhi-65/tml-3840-mongo-stored-name-renames`. **Tier:** Opus, medium effort.

The rules of dispatch 28 hold:

- run only the test files you change, one per command;
- change nothing under `packages/1-framework` beyond `3-tooling/cli`;
- no AI attribution in commits;
- do not push.

## Fix

In `runFilterIsCheckFilter` (`mongo-runner.ts`), five conditions can each be removed with no test failing:

1. the check reads the run's collection;
2. only `$limit` stages follow the `$match`;
3. the postcheck expects `notExists`;
4. the check filter is `exists('_id')`;
5. the first stage holds only `$match`.

Do this:

- Add one `it.each` in `mongo-runner.test.ts` of near-miss transforms, one for each of conditions 1 to 4. Each must get the conditional sentence.
- Condition 5 guards a stage MongoDB rejects anyway. Delete it, unless you find a case where it matters.
- Show that removing each remaining condition fails exactly its own case. Use the reviewer's `cr-probe.mutate.py`, or your own script under `wip/`.

## Done when

- Typecheck and lint pass in `@internal/target-mongo`.
- `mongo-runner.test.ts` passes.
- The mutation check above passes: removing each remaining condition fails exactly its own case.

## Report

Plain English, short: what changed, the mutation results, the commit, and the checks with their results.
