# Dispatch 48 (MongoDB): fixes from review round 29 and QA round 16

**Inputs:**

- **Review:** `projects/migration-statements/slices/stored-name-renames/reviews/pr2-round-29/`. Fix F01 to F05 in `code-review.md`. In `system-design-review.md`, A73 is the same finding as F01 and A74 is the same as F03. The probes are in that folder.
- **QA:** `projects/migration-statements/manual-qa-reports/2026-11-26-qa-stored-names-mongo-round-16.md`, finding 38.

**Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-494725`. **Branch:** `gandhi-65/tml-3840-mongo-stored-name-renames`. **Tier:** Opus, medium effort.

Keep notes in `wip/mongo-stored-names/d36-progress.md`. The rules of dispatch 28 hold:

- run only the test files you change, one per command;
- change nothing under `packages/1-framework` beyond `3-tooling/cli`;
- no AI attribution in commits;
- do not push;
- you may build.

## The decisions (made by the orchestrator)

**The runner's advice covers only the steps the planner prints.** Dispatch 47 went further and also guessed at hand-written copies:

- it treated any `$out` copy followed by any later delete on its source as a pair;
- it warned about a lone `$out` copy.

Those guesses gave false advice (F02, F03). So `mongo-out-copy-reruns.ts` adds advice only when the operations are the pair the planner prints:

- a data transform whose run is a raw aggregate on the target that `$unionWith`s the source with a `$match` filter and ends in `$out` to that target;
- followed by a `deleteDocuments` on that source with the same filter;
- or, for the rename route in item 2, followed by the drop of that source.

For anything else, the runner adds nothing. Remove the warning for a lone `$out` copy that reads only its source.

**The time-series rename route (`collectionRenameRefusal`, the `migration plan` half) names the same copy form** (F01, A73). It reads the new collection, `$unionWith`s the old one, and ends in `$out` to the new collection, followed by the plan's drop of the old one.

- **After the drop**, a re-run is safe: `$unionWith` on a missing collection adds nothing.
- **Between the copy and the drop**, a re-run would copy the documents again. The route says what to do before running again: delete the documents from the old collection, or drop it. The runner gives the same advice for that pair, as in the first decision.

## Fix

1. **The runner's advice.** Narrow the advice to the planner's pair, as above (F02, F03, A74). Add one test where two copies read one source, and one where a summary `$out` is followed by an unrelated delete. Neither must get pair advice.
2. **The time-series rename route.** Name the copy, give the advice for a stop between the copy and the drop, and add the runner advice for that pair. Add a planner test, and a live runner test where the old collection is a regular collection and the new one is a time-series collection with no validator. Stop the apply after the copy, follow the advice, run again, and check each document is in the new collection once.
3. **F04.** An in-place `$out` rewrite printed "still in  and are meant to leave it", with an empty collection list. With the first decision this case gets no advice at all. Pin that in a test.
4. **F05.** Add a test for the stop index set after the last operation. Mutation R07 must fail it.
5. **The advice must reach the user.** Advice that is attached only to MongoDB errors with a numeric code is lost when, for example, a connection drops. Either attach it to every failure after the pair, or make the PR description and docs say exactly when it appears. Prefer attaching it to every failure, if that is a contained change. Report which you chose.
6. **QA 38.** The stop advice adds one sentence: if the command was already run again before the delete finished, the moved documents are in the target more than once. Say how to find them: by the copy's filter, in the target, with the counts doubled.

## Done when

- `mise exec -- pnpm build` is clean.
- `pnpm api:check` passes.
- Typecheck and lint pass in `@internal/target-mongo` and `test/integration`.
- `lint:deps`, `lint:ratchets` and `lint:docs` pass.
- Every test file you change passes, each run on its own.

## Report

Plain English, short:

- for each item, what changed and which test was red first;
- the choice you made in item 5;
- the commits;
- each check, with its result.
