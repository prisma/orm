# Dispatch 52 (MongoDB): fixes from review round 34, QA round 21 and CodeRabbit's second follow-up

**Inputs:**

- **Review:** `projects/migration-statements/slices/stored-name-renames/reviews/pr2-round-34/`:
  - `code-review.md` F01 to F03;
  - `system-design-review.md` A84 to A86.
  - A84 is the same finding as F01.
- **CodeRabbit:** the last entry in `wip/coderabbit/inline-4.md` (comment 4715501673). It is the same finding as F01, seen from the runner's advice.
- **QA:** `projects/migration-statements/manual-qa-reports/2026-11-27-qa-stored-names-mongo-round-21.md`, if it has findings.

**Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-494725`. **Branch:** `gandhi-65/tml-3840-mongo-stored-name-renames`. **Tier:** Opus, medium effort.

Keep notes in `wip/mongo-stored-names/d38-progress.md` under "Dispatch 52". The rules of dispatch 28 hold:

- run only the test files you change, one per command;
- change nothing under `packages/1-framework` beyond `3-tooling/cli`;
- no AI attribution in commits;
- do not push;
- you may build.

Run every build, install, typecheck, lint or test command through `lockf -t 3600 /Users/Shared/claude-shared/heavy-command.lock <command>`.

## Fix

1. **Writes stay stopped until the apply succeeds, on every route** (F01, A84, CodeRabbit).
   - `MOVE_LIMITS` says the source's writes stop "until the apply ends". Change it to "until the apply succeeds, re-runs included", as every other rule already says.
   - The runner's advice must also say it, before any delete or drop by hand: writes to both collections must still be stopped. If the user cannot be sure that nothing wrote to them since the stop, they must keep the source as it is and compare the two collections before running again.
   - Add a live test: write a document to the source after an interrupted copy, then check that the advice does not lead to deleting it. Also update the planner expectations.
2. **The third route for a create from an older migration** (F02). The route says to apply the remaining operations by hand, but nothing then records the migration as applied, so the next `db migrate` stops at the same create again.
   - Find out from the code and the docs whether a command records a migration as applied without running it, and how it is used for MongoDB.
   - If such a command exists, name it in the runner's message, the upgrade note, `docs/reference/error-reference.md` and the PR description. Then follow the route to the end in a test.
   - If no such command exists, remove the route from all four places.
   - Report which case it was, with the evidence.
3. **A weak assertion** (F03). The live "did not finish" test must also check the number of documents, as its sibling does.
4. **The recorded state when a count read fails** (A85). Read the counts before the operation is recorded as in flight. A failed count read must leave the record saying the operation did not start, and `databaseUnchanged` must stay true. Add a test.
5. **Small cleanups** (A86).
   - `thrownFailure`'s `finished` parameter is a yes-or-no value, but the record's `finished` is a count. Rename the parameter.
   - Put the slice of operations that may have run in one shared helper.
6. **QA round 21.** Fix any findings.

Then update `docs/reference/error-reference.md` to match. List every line of `wip/mongo-stored-names/pr-body.md` that needs to change, but do not edit that file.

## Done when

- `mise exec -- pnpm build` is clean.
- `pnpm api:check` passes.
- Typecheck and lint pass in `@internal/target-mongo`.
- `lint:deps`, `lint:ratchets` and `lint:docs` pass.
- Every test file you change passes, each run on its own.

## Report

Write plain English, and keep it short:

- for each item, what changed and which test failed first;
- the outcome of item 2, with its evidence;
- the commits;
- each check, with its result.

## QA round 21 findings

- **40** is F01. QA reproduced it in `wip/qa-mongo/r21i`. Fix it too: the "any other count" sentence names writes to the source as a possible cause, but a write to the source cannot change the target's count. Name only causes that can.
- **41.** The "any other count" branch gives no way to find the cause and no next step. Add both. For example, the user can compare the target's documents with the source's by `_id`, using the copy's filters, and then decide which documents to delete from the source by hand.
- **42** is F02. QA found that `prisma db sign` records the migration once its operations have been applied by hand. Confirm how it works from the code and the docs before you name it.
