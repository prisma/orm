# Dispatch 56 (MongoDB): fixes from review round 38, QA round 25 and CodeRabbit's sixth follow-up

**Inputs.**
- **Review:** `projects/migration-statements/slices/stored-name-renames/reviews/pr2-round-38/`. Fix F01 to F05 in `code-review.md` and A99 to A100 in `system-design-review.md`. A99 is the same finding as F03, and A100 is the same as F01. Also act on the design review's notes for the code pass where they apply.
- **QA:** `projects/migration-statements/manual-qa-reports/2026-11-27-qa-stored-names-mongo-round-25.md`, if it has findings.
- **CodeRabbit:** the last entry in `wip/coderabbit/inline-4.md` (comment 4716042605).

**Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-494725`. **Branch:** `gandhi-65/tml-3840-mongo-stored-name-renames`. **Tier:** Opus, medium effort.

Keep notes in `wip/mongo-stored-names/d38-progress.md` under "Dispatch 56". The rules of dispatch 28 hold:
- run only the test files you change, one per command;
- change nothing under `packages/1-framework` beyond `3-tooling/cli`;
- no AI attribution in commits;
- do not push;
- you may build.

Run every heavy command through `lockf -t 3600 /Users/Shared/claude-shared/heavy-command.lock <command>`. A live test file rebuilds `dist`, so run each one as few times as you can.

## Fix

1. **Step 7 runs the command that stopped, exactly as it was run** (F01, A100). If it had a `--to`, keep it. Never tell the user to run plain `db migrate` there.
2. **Every existing collection the migration creates** (F02). In step 2, tell the user to move aside every collection that already exists and that this migration creates, or to drop it if it is empty. Then step 3's `--to` run does not stop again at the next one. If the runner can name those collections from the operations, name them.
3. **A narrower `$currentOp` query** (F03, A99). Match only this database (`command.$db`) and only an aggregate whose last pipeline stage is `$out` or `$merge` into that collection. Confirm the exact query live. Use it in the runner's text and in steps 2 and 6 of the procedure. Step 6 must check a `$merge` copy back as well, not only a time-series copy.
4. **`killOp` is not immediate** (CodeRabbit point 1). After `killOp`, tell the user to run the `$currentOp` query again and continue only once it lists nothing.
5. **When the source count is 0** (CodeRabbit point 2), the branch must still require two things: the copy has ended (the `$currentOp` check), and nothing wrote to either collection since the stop. Add a unit test for this branch.
6. **The marker-guard test for an extension space** (F04). Run it with policies that permit only migrations, so that guarding every space's marker would make it fail. Check with a mutation that it does fail.
7. **A repeated `_id` in a time-series copy aside** (F05). Copy aside into a time-series collection that has the same options, so documents that share an `_id` are kept. Say what to do when the counts differ: keep the original collection and find out why before dropping anything. Confirm the commands live.
8. **The design review's notes.**
   - If the migration itself inserts documents into the new collection, the counts will not match. Say how to account for that.
   - Step 2 must say what to do when the time-series counts differ; item 7 covers this.
9. **QA round 25.** It had no findings. One of its notes needs a fix: step 4's `$nor` query errors when the collection has no validator, which is always the case for a time-series collection. Give that case a step that works, or say to skip it.

Then update the error reference and the upgrade note. For the upgrade note's link, use the heading anchor the docs site really generates, or point to `#MIGRATION.PRECHECK_FAILED` and name the heading. List every line of `wip/mongo-stored-names/pr-body.md` that needs to change, but do not edit it.

## Done when

- `mise exec -- pnpm build` is clean.
- `pnpm api:check` passes.
- Typecheck and lint pass in `@internal/target-mongo` and `test/integration`.
- `lint:deps`, `lint:ratchets`, `lint:docs`, `check:upgrade-coverage` and `check:error-reference` pass.
- Every test file you change passes, each run on its own.

## Report

Plain English, short:
- for each item, what changed and which test failed first;
- the confirmed `$currentOp` query;
- the commits;
- each check, with its result.
