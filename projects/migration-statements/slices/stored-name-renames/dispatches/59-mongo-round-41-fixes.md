# Dispatch 59 (MongoDB): one route for every collection a create with no after-check finds

**Inputs:**
- **Review:** `projects/migration-statements/slices/stored-name-renames/reviews/pr2-round-41/`, with `code-review.md` F01 and `system-design-review.md` A104. They describe the same defect.
- **QA:** `projects/migration-statements/manual-qa-reports/2026-11-27-qa-stored-names-mongo-round-28.md`, findings 51 and 52.

**Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-494725`. **Branch:** `gandhi-65/tml-3840-mongo-stored-name-renames`. **Tier:** Opus, medium effort.

Keep notes in `wip/mongo-stored-names/d38-progress.md` under "Dispatch 59". The rules of dispatch 28 hold:
- run only the test files you change, one per command;
- change nothing under `packages/1-framework` beyond `3-tooling/cli`;
- no AI attribution in commits;
- do not push;
- you may build.

Run every heavy command through `lockf -t 3600 /Users/Shared/claude-shared/heavy-command.lock <command>`.

## The decision (made by the orchestrator)

**Remove the sentence about a collection an earlier run created.** It can lose data (F01, A104). For example, the run moved documents and then deleted their source, so the next run cannot write them again. It also asks the user to judge something the CLI never shows (QA 52). Every collection the refusal names gets the same advice, whoever made it:
- the drop route, only if the collection holds nothing the user needs;
- the move-aside procedure otherwise.

The procedure must also work when the run writes some of the documents again:
- **Step 5, copy back:** use `whenMatched: "fail"` as now. If it stops on a duplicate `_id`, the run has written a document under that `_id`. Tell the user to compare the two:
  - if they are the same, the document in `<name>_kept` is not needed;
  - if they differ, the user decides which one to keep.
- Then copy the rest with `whenMatched: "keepExisting"`, as the procedure already does for a retry.
- Keep `<name>_kept` until every one of its documents is either in the collection or deliberately not needed. Change step 6's count check to say this, because the counts no longer simply add up.
- Give the command that lists the `_id`s in `<name>_kept` that the collection also holds, so the user can find them. Confirm it live.

Writes stay stopped for the whole procedure (QA 51), and step 4 already covers later operations. Check that the runner's short text now gives no route that skips them.

## Fix

1. Carry out the decision in the runner, the error reference and the upgrade note.
2. Add a live journey, or extend the existing one, for the case in F01: an older migration's create with no after-check, then a newer migration that moves documents into that collection and deletes them from their source, and then a stop. Follow the advice to `db migrate` succeeding. Every moved document must be kept.
3. Update the unit tests and the journey's expected text.
4. The round 41 notes:
   - check that the bounded polling loop in the long-pipeline test fails when it runs out of tries;
   - "copy them back after the run" goes away with the removed sentence.

List the lines of `wip/mongo-stored-names/pr-body.md` that need to change, but do not edit it.

## Done when

- `mise exec -- pnpm build` is clean.
- `pnpm api:check` passes.
- Typecheck and lint pass in `@internal/target-mongo` and `test/integration`.
- `lint:deps`, `lint:ratchets`, `lint:docs`, `check:upgrade-coverage` and `check:error-reference` pass.
- Every test file you change passes, each run on its own.

## Report

Plain English, short:
- for each item, what changed and which test failed first;
- the confirmed command that lists the shared `_id`s;
- the commits;
- each check, with its result.
