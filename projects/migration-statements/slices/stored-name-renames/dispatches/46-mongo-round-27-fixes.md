# Dispatch 46 (MongoDB): fixes from review round 27, QA round 14 and a CodeRabbit follow-up

**Inputs:**

- **Review:** `projects/migration-statements/slices/stored-name-renames/reviews/pr2-round-27/`. Fix F01 to F05 from `code-review.md` and A71 from `system-design-review.md`. Probes are in that folder.
- **QA:** `projects/migration-statements/manual-qa-reports/2026-11-26-qa-stored-names-mongo-round-14.md`, finding 35.
- **CodeRabbit follow-up on comment 4695577586:** a hand-written `$merge` can match on a field other than `_id`, using `on`, and a `whenMatched` pipeline can then update a target document whose `_id` differs from the source document's. In that case the rejected `failingDocumentId` is the target's `_id`, not the source's.

**Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-494725`. **Branch:** `gandhi-65/tml-3840-mongo-stored-name-renames`. **Tier:** Opus, medium effort.

Keep notes in `wip/mongo-stored-names/d34-progress.md`. The rules of dispatch 28 hold:

- run only the test files you change, one per command;
- change nothing under `packages/1-framework` beyond `3-tooling/cli`;
- no AI attribution in commits;
- do not push;
- you may build.

## Fix

1. **F01.** Restore the 12-level chain test in `mongo-planner.document-moves.replanning.test.ts`, which commit 6444bfe510 deleted. Make it assert the plan count (13 statement plans for a chain of 12), not a time. It must fail when the memo is removed.

2. **F02, F03, A71 and QA 35: a time-series destination.** The design for this item:
   - **One owner.** The decision sits where the copy is printed (`documentMoveOf` or `documentMovesText`), so the shared-collection route and the variant route both get it.
   - **When the plan creates the target and only one copy goes into it,** print the copy ending in `$out` with the target's time-series options, as `{ $out: { coll, timeseries: { … } } }`. Use the contract's options and place the copy right after the create. Say that `$merge` cannot write into a time-series collection, and that `$out` replaces the whole collection, which is why it works only for a new collection that receives this one copy.
   - **Any other case** gets hand-written text that is true: `$merge` cannot write into a time-series collection, and `$out` replaces the collection.
     - The target already exists.
     - Several copies go into it.
     - The target is renamed into place.

     Say what does work, as far as the runner and planner can back it. Do not suggest an `insertMany` outside the migration that cannot be ordered within one apply.
   - **Remove** the false sentence that says no `rawAggregate` copy can write there.
   - **Tests:** planner tests for both routes, and a live runner test where the `$out` copy moves the documents into a new time-series collection. If the 8.2.6 time-series-with-validator defect on `main` blocks a live create, use a contract with no validator for that collection and say so. Each test must fail first.

3. **F04.** Add a test row where postchecks are off and idempotency checks are on. It must fail if `skips` becomes `runIdempotency` alone.

4. **F05.** Add a test row with `{ $unset: '_id' }` before the copy. The source lookup must not be offered.

5. **The CodeRabbit follow-up.** Offer the source lookup only when the copy's `$merge` matches on `_id`: `on` is left out or is `'_id'`, and there is no `whenMatched` pipeline. Otherwise, name the `_id` MongoDB reports as the target document's, and give only the pipeline fix. Add a unit test. Add a live test if it is cheap.

## Done when

- `mise exec -- pnpm build` is clean.
- `pnpm api:check` passes.
- Typecheck and lint pass in `@internal/target-mongo` and `test/integration`.
- `lint:deps`, `lint:ratchets` and `lint:docs` pass.
- Every test file you change passes, each run on its own.

## Report

Plain English, short:

- per item, what changed and which test failed first;
- the commits;
- each check, with its result.

Also give a one-sentence reply for CodeRabbit comment 4695577586.
