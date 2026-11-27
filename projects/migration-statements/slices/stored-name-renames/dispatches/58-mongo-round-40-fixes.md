# Dispatch 58 (MongoDB): simplify the advice for a create with no after-check

**Inputs:**

- **Review:** `projects/migration-statements/slices/stored-name-renames/reviews/pr2-round-40/`, with `code-review.md` F01 to F03 and `system-design-review.md` A103.
- **QA:** findings 49 and 50 in `projects/migration-statements/manual-qa-reports/2026-11-27-qa-stored-names-mongo-round-27.md`.

**Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-494725`. **Branch:** `gandhi-65/tml-3840-mongo-stored-name-renames`. **Tier:** Opus, medium effort.

Keep notes in `wip/mongo-stored-names/d38-progress.md` under "Dispatch 58". The rules of dispatch 28 hold:

- run only the test files you change, one per command;
- change nothing under `packages/1-framework` beyond `3-tooling/cli`;
- no AI attribution in commits;
- do not push;
- you may build.

Run every heavy command through `lockf -t 3600 /Users/Shared/claude-shared/heavy-command.lock <command>`. A live test file rebuilds `dist`, so run each one as few times as you can.

## The decision (made by the orchestrator)

**Stop predicting the next run's stops.** For four rounds, every round has found another way the predicted list of later stops is wrong:

- a collection was dropped later;
- the drop route re-runs past the list;
- steps 1 and 4 assume one collection;
- a later migration's creates were missed.

None of these lost data. Each one sent the user to a stop the advice had not named. A stop at a create with no after-check is always safe, and it always gives the same advice for its own collection. So the advice should cover the create that stopped, and say plainly that the next run may stop at another create like it.

1. **Remove the list of other collections,** along with the collection-list read that only it uses. `uncheckedCreateOf` stays the one definition.
2. **Add one fixed sentence:** "The next run may stop at another create in the same state, in this migration or a later one; the same steps apply to it."
3. **Add a second fixed sentence, for a collection that an earlier run of this command created** (A103). Its documents came from that run, and the next run writes them again. So drop it, unless the application has written documents to it since. In that case, keep only those documents and copy them back after the run.
4. **The procedure covers one collection,** the one the error names:
   - Step 1 stops writes to that collection.
   - Step 4 names the changes that operations after its create made to that collection, in this migration and in any later migration the run applies.
5. **QA 50.** A collection that was renamed aside keeps its validator, so the edits in step 4 can be rejected. Tell the user to remove the validator from `<name>_kept` first, with `collMod` and `validator: {}`, and confirm the command live. Remember that the copy back still has to meet the new collection's validator.
6. **The drop route** says to run the command that stopped again, as it was run.

Update the tests, the error reference and the upgrade note to match. List the lines of `wip/mongo-stored-names/pr-body.md` that need to change, but do not edit that file.

## Notes from round 40 to act on

- **The new live test for a long pipeline loops with no limit.** Give it a bound, so that it fails rather than hangs.
- **Fix the wording of `uncheckedCreateRefusal`'s doc comment.**

## Done when

- `mise exec -- pnpm build` is clean.
- `pnpm api:check` passes.
- Typecheck and lint pass in `@internal/target-mongo` and `test/integration`.
- `lint:deps`, `lint:ratchets`, `lint:docs`, `check:upgrade-coverage` and `check:error-reference` pass.
- Every test file you change passes, each run on its own.

## Report

Plain English, short:

- for each item, what changed and which test failed first;
- the confirmed `collMod` command;
- the commits;
- each check, with its result.
