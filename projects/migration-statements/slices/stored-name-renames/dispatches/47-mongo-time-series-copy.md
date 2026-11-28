# Dispatch 47 (MongoDB): a time-series copy that survives a re-run

**Inputs:**

- **Review:** `projects/migration-statements/slices/stored-name-renames/reviews/pr2-round-28/`. Fix `code-review.md` findings F01 to F04 and `system-design-review.md` finding A72. Probes are in that folder.
- **QA:** `projects/migration-statements/manual-qa-reports/2026-11-26-qa-stored-names-mongo-round-15.md`, findings 36 and 37, and its note on wording.

**Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-494725`. **Branch:** `gandhi-65/tml-3840-mongo-stored-name-renames`. **Tier:** Opus, medium effort.

Keep notes in `wip/mongo-stored-names/d35-progress.md`. The rules of dispatch 28 hold:

- run only the test files you change, one per command;
- change nothing under `packages/1-framework` beyond `3-tooling/cli`;
- no AI attribution in commits;
- do not push;
- you may build.

## The decision (made by the orchestrator)

**One copy form for every time-series destination.** Every time-series destination gets the copy that reads the target, adds the moved documents with `$unionWith`, and ends in `$out`. That includes a new target that receives a single copy. Never print the lone `$out` copy: when it runs again after the delete, it empties the collection.

The `$unionWith` form is safe to run again, provided the source no longer holds the moved documents. There are three cases:

- **After the delete has finished:** the source holds nothing, so the copy rewrites the target with what it already holds.
- **Before the copy has run:** the copy runs normally.
- **The only unsafe stop is after the copy, before the delete has finished.** A run there would copy the documents twice, because a time-series collection does not enforce a unique `_id`. The fix the user is told: finish the delete on the source with the same filter, then run again.

## Fix

1. **The copy.** Print the `$unionWith` + `$out` copy for every time-series destination (F01, A72, QA 36). The decision stays in `documentMovesText`.
2. **The route text says:**
   - The copy rewrites the whole target collection.
   - Writes to both collections stop for the whole apply. This is a document written to the target *while* the copy runs, not before it runs (F03).
   - `$out` cannot write to a sharded collection.
   - If the apply stops after the copy and before the delete has finished, finish the delete on the source with the same filter, then run the command again. Do not delete documents from the target.
   - Do not say the target "holds documents" when the planner knows only that it exists (F03).
3. **The runner (QA 37).** A stop after a `$out` copy whose `deleteDocuments` on the same source has not run, or has failed, gives the same advice: finish the delete on the source with the same filter before running again.
   - Find the pair by its shape: a data transform whose run is a `rawAggregate` ending in `$out`, followed by a `deleteDocuments`.
   - If the runner cannot tell that the operations pair up, give the advice in plain words for any stop after a copy that ends in `$out`.
   - Where a copy's failure is described as an "update", call it a copy (QA wording note).
4. **Tests.** Each must fail first.
   - **A live runner test:** a new time-series target, then the route followed, then a stop at an operation after the delete, then a re-run. Every moved document must be in the target exactly once.
   - **A second live test:** a stop between the copy and the delete. Follow the printed advice (finish the delete), run again, and check each moved document is there exactly once.
   - **The three untested branches from F04,** so that each breakage fails:
     - counting only one move's own copies;
     - printing the `$merge` paragraphs for a time-series move;
     - dropping the time-series sentence from the hand-written route.

## Done when

- `mise exec -- pnpm build` is clean.
- `pnpm api:check` passes.
- Typecheck and lint pass in `@internal/target-mongo` and `test/integration`.
- `lint:deps`, `lint:ratchets` and `lint:docs` pass.
- Every test file you change passes, each run on its own.

## Report

Plain English, short:

- for each item, what changed and which test failed first;
- the commits;
- each check, with its result.
