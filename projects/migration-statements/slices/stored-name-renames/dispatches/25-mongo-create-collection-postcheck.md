# Dispatch 25 (MongoDB): `createCollection` gets a postcheck (TML-3929), and round 8 F01

**Ticket:** TML-3929 (read it in Linear) · **Review to fix:** `projects/migration-statements/slices/stored-name-renames/reviews/pr2-round-8/code-review.md` F01 · **QA:** `projects/migration-statements/manual-qa-reports/2026-11-24-qa-stored-names-mongo-round-3.md` finding 9 · **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-494725` · **Branch:** `gandhi-65/tml-3840-mongo-stored-name-renames` · **Tier:** Opus, medium effort

Notes in `wip/mongo-stored-names/d16-progress.md`. The rules of dispatch 10 hold: run only test and journey files you change, one per command; nothing under `packages/1-framework` beyond `3-tooling/cli`; no AI attribution in commits; do not push. No QA is running: you may run `mise exec -- pnpm build`.

## Why

The operator approved fixing TML-3929 in this pull request. `createCollection` in `packages/3-targets/mongo/1-target/src/core/migrations/migration-factories.ts` has an empty postcheck. The runner skips an operation whose postcheck holds, so after a stop later in a migration, a re-run tries the create again and its precheck fails. Our route text works around this by telling the user to remove the create from `migration.ts`, which breaks the migration for every other database (round 8 F01).

## Fix

1. **The postcheck.** The runner evaluates the postcheck first on every run, the first one included (`mongo-runner.ts`, around line 1241). So a postcheck that only tests that the collection exists would skip the create for a collection someone made by hand, which never gets its validator. The postcheck must hold only when the collection exists with the options the call sets: at least `validator` (reuse `validatorBodyFilter`), `validationLevel`, `validationAction`, and each other option the call passes that `listCollections` reports under `options` (collation, capped, size, timeseries, clusteredIndex, changeStreamPreAndPostImages: check what `CreateCollectionOptions` allows and how MongoDB reports each). If an option cannot be matched reliably, leave it out of the filter and say so in the report. Follow the `collMod` postcheck's shape.
2. **Does any plan create a collection and then change its options in the same migration?** If one does, the postcheck would not hold on a re-run after the later change. Search the planner for such a sequence and report what you find; if one exists, tell me before changing it.
3. **Written migrations.** `examples/retail-store/migrations/app/20260513T0505_initial` is the only committed `ops.json` with a create. Write it again the way the repo does (check `pnpm fixtures:check` and the example's scripts), and report whether its migration hash or anything that depends on it changes. Planner and factory snapshots that show the create's checks are updated.
4. **Round 8 F01.** The route text (`documentMoveSteps` and anything else) no longer tells the user to remove the create from `migration.ts`. After a stop, the advice is to fix what stopped the apply and run it again. Keep "do not drop the new collection; it holds the moved documents" only if a printed message can still lead a user to drop it; otherwise remove it. Sweep docs, the upgrade note and the skill for the old advice.
5. **Docs.** The `deferred.md` / PR text claims that the re-run rule does not hold for plans that create a collection go. The upgrade note (`upgrade-instructions/pending/mongo-stored-name-renames/`) says that migrations emitted before this change keep the old create with no postcheck until their `ops.json` is written again, and what a user does after a stop with one of those.

## Tests

- A factory or planner test of the postcheck's filter.
- A runner test against mongodb-memory-server (`test/integration/test/mongo/target-runner/`, the reruns file or a new one): a migration creates a collection, a later operation stops (for example a validator change that rejects a document), the document is fixed, the migration runs again and finishes, and the collection has its validator. Red before the fix.
- A runner test that a collection created by hand beforehand without the validator still stops the create at the precheck (the postcheck does not skip it).
- The journey or test that followed the old "remove the create" advice now follows "run it again".

## Done when

- `mise exec -- pnpm build` is clean; typecheck and lint pass in every touched package, `test/integration` included.
- `mise exec -- pnpm lint:deps`, `lint:ratchets`, `lint:docs`, `fixtures:check`, `check:upgrade-coverage --mode pr` pass.
- Every test and journey file you change passes, each run on its own.
- `git diff --stat origin/main -- packages/1-framework` lists only files under `3-tooling/cli`.

## Report

Plain English, short: per item, what changed and the test red first; the answer to item 2; whether the example migration's hash changed; commits; checks with results.
