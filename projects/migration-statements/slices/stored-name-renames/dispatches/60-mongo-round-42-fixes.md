# Dispatch 60 (MongoDB): fixes from review round 42 and QA round 29

**Inputs**
- **Review:** `projects/migration-statements/slices/stored-name-renames/reviews/pr2-round-42/`, `code-review.md` F01 and `system-design-review.md` A105. Both describe the same defect.
- **QA:** `projects/migration-statements/manual-qa-reports/2026-11-27-qa-stored-names-mongo-round-29.md`, finding 53.

**Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-494725`. **Branch:** `gandhi-65/tml-3840-mongo-stored-name-renames`. **Tier:** Opus, medium effort.

Keep notes in `wip/mongo-stored-names/d38-progress.md` under "Dispatch 60". The rules of dispatch 28 hold:
- run only the test files you change, one per command;
- change nothing under `packages/1-framework` beyond `3-tooling/cli`;
- no AI attribution in commits;
- do not push;
- you may build.

Run every heavy command through `lockf -t 3600 /Users/Shared/claude-shared/heavy-command.lock <command>`.

## Fix

1. **The delete in step 5 for a time-series collection** (F01, A105). Delete with a filter that matches only the document the user rejects, then check that `deletedCount` is 1. Give the filter and say what to match. The `_id`, the time field and the other fields will do; matching the whole document is also fine if that works on a time-series collection. Confirm it live with two documents that share an `_id`.
2. **The count in step 6** (F01). Restate the count as: the number noted in step 3, minus the documents deleted from `items`, plus the documents copied. It must hold when a listed `_id` has more than one document. Also give the matching count case for a `fail` copy that stops after an empty list, which the round 42 code pass notes.
3. **QA 53.** Replace "This holds also if an earlier run of this command created items" with words that say what holds. Take the upgrade note's form: "Drop it only if it holds nothing you need, even when an earlier run created it."
4. **Round 42 note.** Each error names one collection now, so "every collection the error names" should name that one collection.

Update the unit test pins. List the lines of `wip/mongo-stored-names/pr-body.md` that need to change, but do not edit it.

## Done when

- `mise exec -- pnpm build` is clean.
- `pnpm api:check` passes.
- Typecheck and lint pass in `@internal/target-mongo` and `test/integration`.
- `lint:deps`, `lint:ratchets`, `lint:docs`, `check:upgrade-coverage` and `check:error-reference` pass.
- Every test file you change passes, each run on its own.

## Report

Plain English, short:
- for each item, what changed and which test failed first;
- the confirmed delete filter;
- the commits;
- each check, with its result.
