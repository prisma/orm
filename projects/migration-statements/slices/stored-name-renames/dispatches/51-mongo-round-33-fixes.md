# Dispatch 51 (MongoDB): fixes from review round 33, QA round 20 and CodeRabbit's follow-up

**Inputs:**

- **Review:** `projects/migration-statements/slices/stored-name-renames/reviews/pr2-round-33/`: `code-review.md` F01 to F05 and `system-design-review.md` A77 to A83. Some findings repeat each other: A82 is F01, A78 is F03, and A80 and A81 are F02.
- **CodeRabbit:** the last entry in `wip/coderabbit/inline-4.md` (comment 4715357309).
- **QA:** `projects/migration-statements/manual-qa-reports/2026-11-27-qa-stored-names-mongo-round-20.md`, if it has findings.

**Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-494725`. **Branch:** `gandhi-65/tml-3840-mongo-stored-name-renames`. **Tier:** Opus, medium effort.

Keep notes in `wip/mongo-stored-names/d38-progress.md` under "Dispatch 51". The rules of dispatch 28 hold:

- run only the test files you change, one per command;
- change nothing under `packages/1-framework` beyond `3-tooling/cli`;
- no AI attribution in commits;
- do not push;
- you may build.

Run every build, install, typecheck, lint or test command through `lockf -t 3600 /Users/Shared/claude-shared/heavy-command.lock <command>`, because other sessions share this machine.

## The decision (made by the orchestrator)

**How the user tells whether a stopped `$out` copy finished.** The current advice says to look in the target for the `_id` of a source document. That is not reliable. A time-series collection does not enforce a unique `_id`, so the target can already hold a document with that `_id`, and a user who trusts it could delete source documents that were never copied (CodeRabbit).

`$out` writes to a temporary collection and then renames it over the target, so a copy that finished leaves the target with a new UUID. So:

- Before it runs a copy that the planner prints (the copies `unionCopyOf` recognises), the runner reads the target's UUID with `listCollections`. It reads nothing for any other operation.
- When that copy is interrupted, the advice prints the UUID the target had before the copy, and the mongosh command to read it now: `db.getCollectionInfos({ name: "<into>" })[0].info.uuid`.
  - **The UUID changed:** the copy finished. Give the current advice for a finished copy.
  - **The UUID is the same:** the copy did not finish. Delete nothing, and run the command again as it is.
  - **The target did not exist before the copy:** say that if it exists now, the copy finished.
- **Check on a live MongoDB 8.2.6 first, before you build on this,** that `$out` into a time-series collection and into a regular collection both change the UUID. If either does not, stop and report it; do not choose another signal yourself.
- **A write-concern error on the copy is interrupted, not refused** (F01, A82). It carries a code, but the `$out` may already have replaced the target on the primary. Recognise it by its shape, as the driver reports it, and give it the may-have-finished advice. The sentence "Collection X is as it was" must never appear for it.

## Fix

1. Carry out the decision above. Write a live runner test where the target already holds a document with the same `_id` as a source document, the copy is interrupted before `$out` commits, and the advice says to delete nothing. Write a second live test where the copy is interrupted after it commits, and the advice says it finished. Write a unit test for the write-concern error.
2. **The record of where the apply stopped** (A77, A79). Keep one record, owned by the runner. For example: the number of operations that finished, and whether the next one threw while it ran. Then remove the second shape and the `refused` name. Choose the simplest shape that serves both the advice and `databaseUnchanged`.
3. **The re-run text contradicts itself** (F03, A78). When the stopped operation may have run, `rerunText` must not say "operations that already ran are skipped" and then say the copy runs again.
4. **A create written before creates had an after-check** (F02, A80, A81). Give it its own case and its own headline:
   - Say that the runner cannot tell whether an earlier run of this migration made the collection, since this create has no after-check. Never say the collection lacks the options.
   - Give the upgrade note's three routes:
     - write `ops.json` again by running `migration.ts` with node, and only if no other database has applied the migration;
     - drop the collection, if it holds nothing you need;
     - leave the migration as it is, and apply the operations that did not run by hand.
   - Add a test that checks the whole message.
5. **A drop that throws** (F05). Say that it may have run, as the copy's advice does, and never that it "has not run".
6. **The stop-writes wording** (A83). Write one helper that both the move route and the rename routes use, and use "re-runs" throughout.
7. **The missing tests** (F04). Add a test for each of the two finished-marking lines on the collection-command paths. Each test must fail when its line is removed.
8. **QA round 20.** Fix any findings in its report.

Then update `docs/reference/error-reference.md` to match. List every line of `wip/mongo-stored-names/pr-body.md` that needs to change, but do not edit that file.

## Done when

- `mise exec -- pnpm build` is clean.
- `pnpm api:check` passes.
- Typecheck and lint pass in `@internal/target-mongo`.
- `lint:deps`, `lint:ratchets` and `lint:docs` pass.
- Every test file you change passes, each run on its own.

## Report

Write plain English, and keep it short. Give:

- for each item, what changed and which test failed first;
- the result of the UUID check;
- the commits;
- each check, with its result.

## Revised decision for item 1 (after the UUID check failed)

The UUID check fails for time-series collections. On 8.2.6 their `listCollections` entry has no `info.uuid`. The buckets collection's UUID does change, but newer MongoDB versions remove the buckets collection, so nothing should be built on it.

**Use document counts instead.** The route already requires writes to both collections to stop until the apply succeeds, so the counts can only change because of the copy.

- **Before it runs a copy that `unionCopyOf` recognises,** the runner records two counts with `countDocuments`. It records nothing for any other operation.
  - **N:** the target's document count. It is 0 when the target does not exist.
  - **M:** the number of source documents that the copy's filters select. For a copy of the whole source, M is the source's count.
- **When the copy is interrupted, the advice prints N, M, and the mongosh command to count the target now.**
  - **The target holds N + M documents:** the copy finished. Give the current advice for a finished copy.
  - **It holds N:** the copy did not finish. Delete nothing, and run the command again as it is.
  - **Any other count:** something else wrote to the collections. Say so, and tell the user to delete nothing until they have found out what.
  - **M is 0:** the copy has nothing to move. Say the command can run again as it is.
- **If reading the counts fails,** the copy has not started, so the existing advice for a stop before the copy applies.
- **The extra cost:** the two counts scan the same documents that the copy reads. The copy already rewrites the whole target, so the counts add little. Say this in a code comment only if the reason is not clear from the code.
- **Live tests:**
  - **An `_id` the target already holds:** the target holds a document with the same `_id` as a source document. Stop the copy before `$out` commits. The advice must say the copy did not finish.
  - **A stop after the commit:** stop the copy after `$out` has committed. The advice must say it finished.

  Use `wip/qa-mongo/proxy20.mjs` for both.

Items 2 to 8 are unchanged.
