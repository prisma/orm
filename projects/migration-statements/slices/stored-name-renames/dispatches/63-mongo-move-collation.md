# Dispatch 63 (MongoDB): the delete after a move must select the documents the copy took

**Input:** the note under comment 4717107894 in `wip/coderabbit/triage-5.md`.

A `$unionWith` copy, and a `$merge` copy too, may read the source with the target's collation, not the source's own. Dispatch 62 confirmed this live for `$unionWith`. The plan's `deleteDocuments` on the source then uses the source's collation, so it can delete documents the copy never took. Take a case-insensitive target and a case-sensitive source holding `kind: "Sample"`, with the filter `{ kind: "sample" }`: the copy and the delete then select different documents. That loses data on the move route this PR adds.

**Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-494725`. **Branch:** `gandhi-65/tml-3840-mongo-stored-name-renames`. **Tier:** Opus, medium effort.

Keep notes in `wip/mongo-stored-names/d38-progress.md` under "Dispatch 63". The rules of dispatch 28 hold:

- run only the test files you change, one per command;
- change nothing under `packages/1-framework` beyond `3-tooling/cli`;
- no AI attribution in commits;
- do not push;
- you may build.

Run every heavy command through `lockf -t 3600 /Users/Shared/claude-shared/heavy-command.lock <command>`.

## Fix

1. **Confirm live on MongoDB 8.2.6** which collation each part uses, for both copy forms (`$merge` and `$unionWith` + `$out`), and for the plan's `deleteDocuments`. If the copy and the delete always select the same documents, stop here and report that.
2. **If they can differ, choose the smaller safe fix and say why you chose it.** There are two options:
   - Make the delete select the same documents as the copy. For example, give it the collation the copy reads with, if `deleteDocuments` can carry one.
   - Have the planner refuse the move when the source and target collations differ, with a route the user can take.

   The collations are in the contract's collection options, so the planner can see them.
3. **Add a test that fails first:** a live runner test with the case above, showing that after the fix no source document is deleted without being copied.
4. **Update the error reference and the route text** if the user is told anything new.

List the lines of `wip/mongo-stored-names/pr-body.md` that need to change, but do not edit it.

## Done when

- `mise exec -- pnpm build` is clean.
- `pnpm api:check` passes.
- Typecheck and lint pass in `@internal/target-mongo` and `test/integration`.
- `lint:deps`, `lint:ratchets`, `lint:docs`, `check:upgrade-coverage` and `check:error-reference` pass.
- Every test file you change passes, each run on its own.

## Report

Plain English, short:

- what the live check showed;
- the fix you chose, and why;
- which test failed first;
- the commits;
- each check, with its result.
