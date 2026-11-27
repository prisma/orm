# Dispatch 57 (MongoDB): fixes from review round 39, QA round 26 and CodeRabbit's seventh follow-up

**Inputs**
- **Review:** `projects/migration-statements/slices/stored-name-renames/reviews/pr2-round-39/`. Fix F01 in `code-review.md`, A101 and A102 in `system-design-review.md`, and the orphaned doc comment that both passes note.
- **QA:** `projects/migration-statements/manual-qa-reports/2026-11-27-qa-stored-names-mongo-round-26.md`, if it has findings.
- **CodeRabbit:** the last entry in `wip/coderabbit/inline-4.md` (comment 4716205060), with the orchestrator's plan under it.

**Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-494725`. **Branch:** `gandhi-65/tml-3840-mongo-stored-name-renames`. **Tier:** Opus, medium effort.

Keep notes in `wip/mongo-stored-names/d38-progress.md` under "Dispatch 57". The rules of dispatch 28 hold:
- run only the test files you change, one per command;
- change nothing under `packages/1-framework` beyond `3-tooling/cli`;
- no AI attribution in commits;
- do not push;
- you may build.

Run every heavy command through `lockf -t 3600 /Users/Shared/claude-shared/heavy-command.lock <command>`. A live test file rebuilds `dist`, so run each one as few times as you can.

## Fix

1. **The collections the next run will stop at** (F01, A102). The runner must name every collection that the next run will find already there. That means:
   - the creates with no after-check that ran earlier in this run, in `operations.slice(0, operationIndex)`. The runner knows these exist, so it reads nothing for them;
   - the later ones that already exist, as now. For a space other than the application's, look up to the end of that space's plan, not only to the end of this migration.

   Widen step 2 of the procedure to cover these collections. Fix its pointer to a `migration.ts` for an extension. Add unit tests for two migrations in the application space and for an extension space.
2. **One definition** (A101). Make `uncheckedCreateOf` the only definition of "a create with no after-check", and check it once, in the method that reads the database.
3. **The orphaned doc comment.** Put `collectionInPlace`'s doc comment back above `collectionInPlace`, and leave the new method with one doc comment.
4. **Truncated commands** (CodeRabbit point 1). `$currentOp` truncates commands over 1 KB, and then `command.$db` and `command.pipeline` are gone.
   - Make the query also list any operation on this database whose command was truncated.
   - Say in the advice that a listed truncated operation may be the copy, so treat it as one: wait for it to end, or end it.
   - Confirm live how a truncated aggregate looks in `$currentOp` on 8.2.6, for example its `ns` and `command.$truncated`, and match on what is really there.
   - Add a live test with a copy whose pipeline is over 1 KB.
5. **The window for writes** (CodeRabbit point 2). Every count condition and the zero-source branch must say "since the apply started", not "since the stop". This matches the route's rule that writes stop for the whole apply.
6. **QA round 26.** It had no findings. One of its notes needs a fix: the drop route names only the stopped collection. It must cover every collection item 1 names, so that a user who drops only one is not refused again.

Then update the error reference and the upgrade note. List the lines of `wip/mongo-stored-names/pr-body.md` that need to change, but do not edit it.

## Done when

- `mise exec -- pnpm build` is clean.
- `pnpm api:check` passes.
- Typecheck and lint pass in `@internal/target-mongo` and `test/integration`.
- `lint:deps`, `lint:ratchets`, `lint:docs`, `check:upgrade-coverage` and `check:error-reference` pass.
- Every test file you change passes, each run on its own.

## Report

Plain English, short:
- for each item, what changed and which test failed first;
- what a truncated aggregate looks like in `$currentOp`;
- the commits;
- each check, with its result.
