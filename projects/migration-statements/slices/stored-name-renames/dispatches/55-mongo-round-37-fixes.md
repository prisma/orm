# Dispatch 55 (MongoDB): fixes from review round 37, QA round 24 and CodeRabbit's fifth follow-up

**Inputs:**

- **Review:** `projects/migration-statements/slices/stored-name-renames/reviews/pr2-round-37/`. Fix F01 to F03 in `code-review.md` and A95 to A98 in `system-design-review.md`. Some findings repeat others:
  - F01 and F02 are A96 and A97.
  - F03 is A98.
- **QA:** findings 47 and 48 in `projects/migration-statements/manual-qa-reports/2026-11-27-qa-stored-names-mongo-round-24.md`.
- **CodeRabbit:** the last entry in `wip/coderabbit/inline-4.md` (comment 4715902641), with the orchestrator's plan under it.

**Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-494725`. **Branch:** `gandhi-65/tml-3840-mongo-stored-name-renames`. **Tier:** Opus, medium effort.

Keep notes in `wip/mongo-stored-names/d38-progress.md` under "Dispatch 55". The rules of dispatch 28 hold:

- run only the test files you change, one per command;
- change nothing under `packages/1-framework` beyond `3-tooling/cli`;
- no AI attribution in commits;
- do not push;
- you may build.

Run every heavy command through `lockf -t 3600 /Users/Shared/claude-shared/heavy-command.lock <command>`. A live test file rebuilds `dist`, so run each one as few times as you can.

## The decisions (made by the orchestrator)

**1. The move-aside procedure lives in one place, the error reference.** It has too many steps to fit in an error message, and each round has found another step missing. So:

- Write the procedure in full in `docs/reference/error-reference.md`, in its own section.
- The runner's message names the route in one or two sentences, says it keeps the documents, and points to that section by its heading.
- The upgrade note points to the same section.

The procedure, for the application space:

1. Stop the application's writes to the collection until the last step has finished.
2. Move the collection aside to `<name>_kept`.
   - **Regular collection:** use `renameCollection`. If `<name>_kept` already exists, choose another name.
   - **Time-series collection:** MongoDB cannot rename one. Copy it to `<name>_kept` with `$out`, check that the two counts match, then drop the original.
3. Run `db migrate --to <this migration's directory>`, so that later migrations do not run on the empty collection.
4. Make the documents in `<name>_kept` meet the collection as it now is.
   - Apply every change that this migration's later operations made to this collection's documents.
   - Check that the documents meet the validator and the unique indexes that the migration created.
5. Copy the documents back.
   - **Regular collection:** use `$merge` with `whenMatched: "fail"`.
   - **Time-series collection:** use the `$unionWith` + `$out` form that the planner prints.
6. Compare the counts.
   - If they do not match, keep `<name>_kept`, fix the documents and copy again.
   - Drop `<name>_kept` only once the counts match.
7. Run `db migrate` to apply any later migrations. Then allow writes again.

For an extension space, `--to` cannot pick the extension's migration. Say so. Tell the user that the later migrations of that space also run on the empty collection, and that their changes must be applied to the `_kept` documents before the copy back.

Follow the procedure in a live journey for a regular collection, and for a time-series collection if the journey harness can create one. Each step's command must run as printed. Have the journey also check that a `$merge` that fails partway keeps `_kept`.

**2. Before the counts, check that no copy is still running** (CodeRabbit 4715902641). After a dropped connection, MongoDB keeps running an aggregate that ends in `$out`. So the advice tells the user to check first that no aggregate on the target is running, with a command that works in mongosh. For example, `db.aggregate([{ $currentOp: {} }, { $match: { "command.aggregate": "<into>" } }])` on the admin database. If one is running, wait for it to end or end it with `db.killOp(<opid>)`, then count.

- Confirm the exact command live.
- Add a live test that drops the client connection after the request reaches the server and before the copy ends. A slow pipeline, or a proxy that holds the reply, can give you that.

## Fix

1. Carry out both decisions.
2. **A95.** Keep only `policiesInForce` and remove `checkedPolicies`. The runner itself guards the marker write for the application space, as `signSpaceMarker` does with `space === APP_SPACE_ID`. Keep the existing tests of the marker guard passing.
3. **A98, F03.** "Settle by hand" must say that the next run copies again every source document the copy selects. So before running again, the source must hold only the documents the target does not.
4. **QA 48.** An extension space has no `migration.ts`, so leave the "write `ops.json` again" route out for an extension space. In its place, say that the operations come from the extension package.

Then update the error reference and the upgrade note. List every line of `wip/mongo-stored-names/pr-body.md` that needs to change, but do not edit that file.

## Done when

- `mise exec -- pnpm build` is clean.
- `pnpm api:check` passes.
- Typecheck and lint pass in `@internal/target-mongo` and `test/integration`.
- `lint:deps`, `lint:ratchets`, `lint:docs` and `check:upgrade-coverage` pass.
- Every test file you change passes, each run on its own.

## Report

Plain English, short:

- for each item, what changed and which test failed first;
- the confirmed `$currentOp` command;
- the commits;
- each check, with its result.
