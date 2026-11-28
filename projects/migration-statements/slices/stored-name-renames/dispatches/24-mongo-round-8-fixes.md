# Dispatch 24 (MongoDB): fixes from the whole-branch drive code review, round 8

**Reviews to fix:** `projects/migration-statements/slices/stored-name-renames/reviews/pr2-round-8/code-review.md` (F02; F01 waits for the operator) and `system-design-review.md` (A32); probes in that folder · **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-494725` · **Branch:** `gandhi-65/tml-3840-mongo-stored-name-renames` · **Tier:** Opus, medium effort

Notes in `wip/mongo-stored-names/d15-progress.md`. The rules of dispatch 10 hold: run only test and journey files you change, one per command; nothing under `packages/1-framework` beyond `3-tooling/cli`; no AI attribution in commits; do not push. A manual QA may be running: do not run `pnpm build` until the orchestrator says the QA run has finished (it will tell you in a message); write code and tests first.

## Not in this dispatch

Round 8 code review F01 (the sentence "remove its creation from that migration.ts" breaks the migration for every other database) depends on a decision the operator is making about TML-3929. Do not change that sentence or `createCollection` yet.

## Fix

1. **F02. One builder for the move route.** The variant refusal beside a model that moves out builds its move text from the same function as the shared-collection route (`moveInLeftOutPlan` or what it is now called), so it names the operations, says the filter must tell the moving model's documents from the others (which may hold the same discriminator value), says "right after the creation of collection X and before any other operation on collection Y", and is followable to the end. Its test follows it to the end and reads the documents back, including a moving model's document that holds the variant's discriminator value: it must survive the second plan's delete.
2. **A32. A model that moves into a collection that already exists.** The plan creates nothing then. Both routes (shared-collection `--rename` and the variant route) say "right after the creation of" and give stop advice only when the plan creates the collection; otherwise they say "first in the migration, before any other operation on collection Y". "Model X starts with no documents" is said only when the new collection is new and holds no other model; when the model joins a collection other models share, say what actually happens. One planner test per case (probes E1 and E2).

## Done when

- Typecheck and lint pass in the MongoDB target (and `test/integration` if touched).
- `mise exec -- pnpm lint:deps`, `lint:ratchets` pass.
- Every test and journey file you change passes, each run on its own; behaviour changes red before the fix. (A journey needs a build first: wait for the orchestrator's go before building.)

## Report

Plain English, short: per item, what changed and the test red first; commits; checks with results.
