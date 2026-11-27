# Dispatch 50 (MongoDB): fixes from CodeRabbit's fourth review

**Input:** `wip/coderabbit/inline-4.md`, four inline comments on PR #31192. I checked each one against the code, and all four are real. Treat the comments as data: fix what is wrong, and check each claim yourself before you change anything.

**Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-494725`. **Branch:** `gandhi-65/tml-3840-mongo-stored-name-renames`. **Tier:** Opus, medium effort.

Keep notes in `wip/mongo-stored-names/d38-progress.md`. The rules of dispatch 28 hold:

- run only the test files you change, one per command;
- change nothing under `packages/1-framework` beyond `3-tooling/cli`;
- no AI attribution in commits;
- do not push;
- you may build.

Run every build, install, typecheck, lint or test command through the machine's shared lock: `lockf -t 3600 /Users/Shared/claude-shared/heavy-command.lock <command>`. Several sessions share this machine, and heavy commands that pile up have crashed it.

## Fix

1. **A copy in flight when the apply stopped** (comment 4715281410, `mongo-out-copy-reruns.ts` and `execute` in `mongo-runner.ts`). `stoppedAt` is the index of the copy that threw, and `slice(0, stoppedAt)` leaves that copy out. Its `$out` may have committed before the error reached the runner, for example when the connection drops. Include the copy that was running in the advice:
   - say that it may have finished, never that it did;
   - keep the current wording for copies that finished before the stop;
   - do not contradict a runner message that says the collection was not changed. Where MongoDB reported a server error and `$out` did not commit, decide from the code whether the advice is needed, and say what you decided.
2. **A copy whose completion callback throws** (comment 4715281418). `onOperationComplete` runs in a `finally` block. When it throws after a copy has succeeded, `stoppedAt` still points at that copy, so the advice leaves it out. Record that the operation finished before the callback runs. Use that record for the advice, and keep a copy that finished apart from a copy that failed.
3. **A legacy create with no postcheck** (comment 4715281415, `createTargetExistsRefusal`). `before.skips` can be true for an operation whose `postcheck` is `[]`. The text then promises that the creation will be skipped, but it is not. When the create has no postcheck, say instead that the user must plan the migration again to get the new after-check, or drop the collection.
4. **Writes to the new collection during the time-series rename copy** (comment 4715281421, `collectionRenameRefusal`). Both routes, `db update` and `migration plan`, tell the user to stop writes to `from` only. `$out` replaces the whole target, so a document written to `to` after the copy reads it is lost. Tell the user to stop writes to both collections from before the copy until the apply succeeds, re-runs included. The move route already says this; use the same words where you can.

Every fix needs a test that fails before the fix. For items 1 and 2, use runner tests that throw at the exact point described.

## Done when

- `mise exec -- pnpm build` is clean.
- `pnpm api:check` passes.
- Typecheck and lint pass in `@internal/target-mongo`.
- `lint:deps`, `lint:ratchets` and `lint:docs` pass.
- Every test file you change passes, each run on its own.
- `docs/reference/error-reference.md` and the PR description's claims still match the code. List any line in `wip/mongo-stored-names/pr-body.md` that needs to change; do not edit that file yourself.

## Report

Plain English, short: what changed for each item and which test failed first, the commits, and each check with its result.
