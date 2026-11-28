# Dispatch 43 (MongoDB): fixes from review round 24

**Review:** `projects/migration-statements/slices/stored-name-renames/reviews/pr2-round-24/code-review.md`, findings F01 and F02. The probes are in that folder. **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-494725`. **Branch:** `gandhi-65/tml-3840-mongo-stored-name-renames`. **Tier:** Opus, medium effort.

The rules of dispatch 28 hold:

- run only the test files you change, one per command;
- change nothing under `packages/1-framework` beyond `3-tooling/cli`;
- no AI attribution in commits;
- do not push;
- you may build.

## Fix

1. **F01.** `mongo-runner.ts` advises "move the copy to after that update". That advice is wrong when the target collection is renamed between the copy and the validator update (the `, as collection people` case). In that case it must also tell the user to point the copy's `$merge` at the target's later name.
   - Add the missing comma in the same sentence.
   - Pin the renamed case in `mongo-runner.copy-rejections.test.ts`. The test must fail first.
2. **F02.** When there is no plan, `dropsSource` in `mongo-statement-planning.ts` must use the planner's own rule for whether a collection is dropped: the control policy is `managed`, through `collectionControlOf`, the same way `planCalls` decides it, and the destination does not have the collection.
   - Add the case of an `external` source that the destination leaves out to `mongo-planner.document-moves.left-behind.test.ts`. The test must fail first.

## Done when

- `mise exec -- pnpm build` is clean.
- `pnpm api:check` passes.
- Typecheck and lint pass in `@internal/target-mongo`.
- `lint:deps` passes.
- Each changed test file passes, run on its own.

## Report

Plain English, short:

- what changed in each item, and which test failed first;
- the commits;
- the checks, each with its result.
