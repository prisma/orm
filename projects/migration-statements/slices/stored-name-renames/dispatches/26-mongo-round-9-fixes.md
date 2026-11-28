# Dispatch 26 (MongoDB): fixes from the whole-branch drive code review, round 9

**Reviews to fix:** `projects/migration-statements/slices/stored-name-renames/reviews/pr2-round-9/code-review.md` (F01, F02) and `system-design-review.md` (A33 to A36); probes in that folder (`cr-probe.*`, `sd-probe.*`) · **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-494725` · **Branch:** `gandhi-65/tml-3840-mongo-stored-name-renames` · **Tier:** Opus, medium effort

Notes in `wip/mongo-stored-names/d17-progress.md`. The rules of dispatch 10 hold: run only test and journey files you change, one per command; nothing under `packages/1-framework` beyond `3-tooling/cli`; no AI attribution in commits; do not push. No QA is running: you may build.

## Fix

1. **F01.** `runner-postcheck-full-definition.test.ts`: `beforeEach` cannot drop `system.views` while a time-series collection exists, so three new cases fail in the hook. Reset with `db.dropDatabase()` (or the equivalent the file's other helpers use). Run the file and show all cases pass.
2. **F02.** MongoDB does not report `changeStreamPreAndPostImages: { enabled: false }`, `collation: { locale: 'simple' }` or `capped: false`, so the postcheck fails after a create that succeeded, on every database, and the migration can never be applied. Treat those values as "not set" when building the postcheck filter, the way `isDisabledChangeStream` in `canonicalize-introspection.ts` already does for the verifier (reuse it if the layering allows). Runner cases for each of the three, red first. Adjust the sentence in ADR 188. Also make the option lists exhaustive by type, so a new `CreateCollectionOptions` field fails to compile until it is placed in one list (the system-design pass raised this).
3. **A33.** The routes decide "the plan creates the collection" from `!hasCollection(fromContract, to)`, but the planner writes no `createCollection` for a new collection with indexes and no validator (contracts read from a Prisma 6 schema). Derive `created` from the same decision the planner uses to emit the create, so the text never names a creation the plan lacks. A planner test for that case (the probe in `sd-probe.test.ts`).
4. **A34.** ADR 188, the upgrade note and the MongoDB Family doc say a re-run finishes a stopped migration with no exception. Say where it ends: a hand-written `migration.ts` that changes the options of a collection it creates earlier in the same migration fails the create's postcheck on a re-run. One sentence each.
5. **A35.** Record the `createCollection` postcheck in the slice `spec.md` and `plan-pr2.md`: what it checks, that it changes every emitted MongoDB create and the `retail-store` example migration's hash, and one acceptance criterion (a migration stopped after a create finishes when run again; a collection made another way still stops at the precheck) with the tests that prove it.
6. **A36.** The time-series rename route ("first create collection X yourself with the same time-series options") works only under `db update`; under `migration plan` the plan's own create stops at its precheck, as on `main`. Make the route say it is for `db update`, if that is a contained change in the text; record the `migration plan` case in `deferred.md` either way.

## Done when

- `mise exec -- pnpm build` is clean; typecheck and lint pass in every touched package, `test/integration` included.
- `mise exec -- pnpm lint:deps`, `lint:ratchets`, `lint:docs`, `fixtures:check`, `check:upgrade-coverage --mode pr` pass.
- Every test and journey file you change passes, each run on its own; behaviour changes red before the fix.
- `git diff --stat origin/main -- packages/1-framework` lists only files under `3-tooling/cli`.

## Report

Plain English, short: per item, what changed and the test red first; commits; checks with results.
