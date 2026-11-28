# Dispatch 64 (MongoDB): the move's delete carries the copy's collation

**Inputs**
- **Review:** `projects/migration-statements/slices/stored-name-renames/reviews/pr2-round-45/`. Fix A107 and A108 in `system-design-review.md`, and F01 to F03 in `code-review.md`.
- **QA:** finding 55 in `projects/migration-statements/manual-qa-reports/2026-11-27-qa-stored-names-mongo-round-32.md`.
- **Earlier evidence:** `wip/mongo-stored-names/d63/` and the notes under "Dispatch 63" in `wip/mongo-stored-names/d38-progress.md`.

**Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-494725`. **Branch:** `gandhi-65/tml-3840-mongo-stored-name-renames`. **Tier:** Opus, medium effort.

Keep notes in `wip/mongo-stored-names/d38-progress.md` under "Dispatch 64". The rules of dispatch 28 hold:
- run only the test files you change, one per command;
- change nothing under `packages/1-framework` beyond `3-tooling/cli`;
- no AI attribution in commits;
- do not push;
- you may build.

Run every heavy command through `lockf -t 3600 /Users/Shared/claude-shared/heavy-command.lock <command>`. Another agent may be using `wip/qa-mongo/db-uri.txt`. Start your own server with its own URI file, so that you do not overwrite theirs.

## The decision (made by the orchestrator)

**Replace the runner refusal with a delete that selects what the copy took** (A107, F01). This is the brief's first option from dispatch 63.

- The `$unionWith` + `$out` copy reads the source with the target's collation. So the plan's `deleteDocuments` on the source must use the same collation.
- Add an optional collation to the raw delete command, and carry it through lowering, the adapter, the `ops.json` serializer and the delete's postcheck.
- The `deleteDocuments` factory takes it as an option, so the route the planner prints can pass it.
- The planner prints it for a time-series move whenever the target has a collation. It gives the target's collation as the contract states it.
- Check that the content hash of an existing delete without a collation does not change. Store the field only when it is set, as `bypassDocumentValidation` already does.

**Then remove:**
- the runner refusal (`comparesStrings` and what only it uses);
- `DocumentMove.collationsDiffer` (A108);
- the route text and error-reference paragraphs about the refusal, including "numbers and dates" (F02);
- the tests of the refusal.

F03 goes with them.

**Keep:** the runner's `sameCollation`, which gates the count advice. Make it use the comparison the schema verifier already uses for collations (A108), so that only one rule exists.

**Changes in the family packages are within scope.** None is in the framework domain. If something forces a change there, stop and report.

**Tests**
- A live test with both collation pairs. A string filter and a `$in` filter must move every document exactly once, with nothing lost.
- A test that a delete without a collation serializes as before.
- A planner test that the printed route passes the collation.

## Also fix: QA 55

A data-transform aggregate that ends in `$out` or `$merge`, and that the runner does not recognise as the planner's copy, can stop when the connection drops. Today the error is rethrown raw as `CLI.UNEXPECTED`, which says to try again, and trying again copies the documents a second time.

Report it as `MIGRATION.EXECUTION_FAILED`, with plain advice:
- the copy may have finished;
- check that it has ended, with the `$currentOp` query;
- do not run the command again until the two collections are settled by hand.

This gives no count route and claims nothing it cannot know. Add a unit test.

## Done when

- `mise exec -- pnpm build` is clean.
- `pnpm api:check` passes. Run `pnpm api:update` if the lists change, and list the changed exports.
- Typecheck and lint pass in `@internal/target-mongo`, the family packages you change, and `test/integration`.
- `lint:deps`, `lint:ratchets`, `lint:docs`, `check:upgrade-coverage` and `check:error-reference` pass.
- Every test file you change passes, each run on its own.

## Report

Plain English, short:
- for each item, what changed and which test failed first;
- the export changes;
- the commits;
- each check, with its result;
- the lines of `wip/mongo-stored-names/pr-body.md` to change.
