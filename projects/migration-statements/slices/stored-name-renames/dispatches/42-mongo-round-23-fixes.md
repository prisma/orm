# Dispatch 42 (MongoDB): fixes from review round 23 and QA round 13

**Review:** `projects/migration-statements/slices/stored-name-renames/reviews/pr2-round-23/code-review.md` (F01 to F03). Its probes and mutation logs are in that folder. **QA:** `projects/migration-statements/manual-qa-reports/2026-11-25-qa-stored-names-mongo-round-13.md`, finding 34. **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-494725`. **Branch:** `gandhi-65/tml-3840-mongo-stored-name-renames`. **Tier:** Opus, medium effort.

Keep notes in `wip/mongo-stored-names/d32-progress.md`. The rules of dispatch 28 hold:

- run only the test files you change, one per command;
- change nothing under `packages/1-framework` beyond `3-tooling/cli`;
- no AI attribution in commits;
- do not push;
- you may build.

## Fix

1. **F01.** Sometimes the plan without the refused statements is itself refused, so there is no plan to read. In that case, decide from whether the destination contract still has the source collection. Do not decide from whether any model stays.
   - **The destination keeps the source:** the models are removed with no question.
   - **The destination does not keep it:** the drop asks about every model the drop loses.

   Add a planner test for each case, using the review's probe for the second. Red first.
2. **F02.** `checksDocumentsOf` in `mongo-runner.ts` has three conditions. Add three negative tests, each differing from the planner's check in exactly one of them. Removing any one condition must fail exactly its own test. Show this with a mutation check.
3. **F03.** Add a test where another origin model moves out by its own `@@map` change. The route must not say that model still reads the source. The test must fail if `readersOfSource` is replaced by `staysIn(group)`.
4. **QA 34.** A copy can be rejected when the later validator update does not check documents. This happens when someone has set `checkDocuments` to false in `migration.ts`. The advice must also give the option that works: move the copy to after that validator update. Pin it with a runner unit test, red first.

## Done when

- `mise exec -- pnpm build` is clean.
- `pnpm api:check` passes.
- Typecheck and lint pass in `@internal/target-mongo`.
- `lint:deps` and `lint:ratchets` pass.
- Every test file you change passes, each run on its own.
- The mutation checks in items 2 and 3 pass.

## Report

Plain English, short:

- per item, what changed, and which test was red first or which mutation result shows the test can fail;
- the commits;
- each check, with its result.
