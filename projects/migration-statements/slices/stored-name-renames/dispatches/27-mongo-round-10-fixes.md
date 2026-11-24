# Dispatch 27 (MongoDB): fixes from the whole-branch drive code review, round 10

**Reviews to fix:** `projects/migration-statements/slices/stored-name-renames/reviews/pr2-round-10/code-review.md` (F01, F02, and the deferred normalisation note) and `system-design-review.md` (A37, A38); probes in that folder (`cr-probe.*`, `sd-probe.*`) · **QA:** `projects/migration-statements/manual-qa-reports/2026-11-24-qa-stored-names-mongo-round-4.md` (findings listed below, if any) · **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-494725` · **Branch:** `gandhi-65/tml-3840-mongo-stored-name-renames` · **Tier:** Opus, medium effort

Notes in `wip/mongo-stored-names/d18-progress.md`. The rules of dispatch 10 hold: run only test and journey files you change, one per command; nothing under `packages/1-framework` beyond `3-tooling/cli`; no AI attribution in commits; do not push. No QA is running: you may build.

## Fix

1. **F01. A view with the new collection's name passes the postcheck.** The runner then skips the create and fails later with a server error, where `main` stopped at the precheck with a clear message. The postcheck also requires `type` to be `collection` or `timeseries` (whichever the call creates), and that `viewOn`, `expireAfterSeconds`, `storageEngine`, `indexOptionDefaults` and `encryptedFields` are absent unless the call sets them. A runner case with a view of that name, red first; update the factory unit test.
2. **F02.** The header comment of `stored-name-routes.mongo.e2e.test.ts` (line 9) still says a stop after the create is finished by removing the create. Make it match the route, or delete it if the test names already say it.
3. **A37. A collection renamed into the target in the same plan.** When the plan renames another collection into the destination (probe J2: `guests` to `members` with no statement), there is no creation, and a move put first makes `$merge` create `members` so the rename then stops. Give the move text a third placement, "right after the rename of collection X to Y and before any other operation on collection Z", taken from the plan's collection renames, in both the shared-collection route and the variant route. A planner test for each route, red first. Follow one to the end in a runner test or journey if the existing T-journeys make that cheap.
4. **A38. One rule for what MongoDB reports.** The postcheck and the schema verifier each decide which option values MongoDB does not report, and they disagree on `collation: { locale: 'simple' }`: the verifier reports it as drift, so `db migrate` with such a contract fails at the verify after apply (also on `main`). Give the rule one home in the MongoDB family (beside `isDisabledChangeStream`) and use it in both. If moving the verifier onto it is more than a contained change, stop and tell me instead.
5. **Values MongoDB rewrites at create** (code review's deferred note): `max` of 0 or less reported as `2147483647`, fractional `size` truncated, `validator: {}` dropped. Only `max` can come from a contract (TypeScript builder). If item 4's shared rule can describe these too in a few lines, do it with tests; otherwise record them in `deferred.md` with the case for each.

## QA round 4 (scratch projects in `wip/qa-mongo/r4a` to `r4l`)

6. **QA 11 🛑. Move placement when the target collection already exists.** "At the start of the operations" puts the move before the target's validator change, so the target's current validator rejects the moved documents and `db migrate` fails on every database. The QA runner found that right after the target's validator update works. Work out a placement that holds in every order the planner can write (the target's validator update, the source collection's rewrites, item 3's rename) and say it in the text for both routes; follow it to the end in a runner test or journey where the target exists and has a validator. If some plan order leaves no position that works, stop and tell me.
7. **QA 12 ⚠️.** The precheck failure for a collection that already exists (made another way) tells the user to run `prisma db verify`, which shows only "Hash mismatch". If that text is in the MongoDB target, make it name the two fixes that work: drop the collection if it holds nothing to keep, or give it the options the contract sets so the create is skipped. If the text is in `packages/1-framework` beyond `3-tooling/cli`, record it in `deferred.md` instead.
8. **QA 13 ⚠️.** The time-series `--rename` route text: say for each sentence which command it is about (`db update` or `migration plan`), and where to read the options the contract gives the collection. Keep it short.
9. **QA 14 🛑. A time-series contract with a validator.** On MongoDB 8.2.6 the first migration of any time-series contract fails with `CLI.UNEXPECTED` "'timeseries' is not allowed with 'validator'". Check on a build of `origin/main` (in a separate worktree under `wip/`, or by reading whether `main` emits a validator for a time-series create) whether this is on `main`. Report the answer; do not fix it in this dispatch unless this branch caused it. Either way, the time-series route text must not tell the user to give the collection a validator if MongoDB refuses one: correct it to what works.

## Done when

- `mise exec -- pnpm build` is clean; typecheck and lint pass in every touched package, `test/integration` included.
- `mise exec -- pnpm lint:deps`, `lint:ratchets`, `lint:docs`, `fixtures:check`, `check:upgrade-coverage --mode pr` pass.
- Every test and journey file you change passes, each run on its own; behaviour changes red before the fix.
- `git diff --stat origin/main -- packages/1-framework` lists only files under `3-tooling/cli`.

## Report

Plain English, short: per item, what changed and the test red first; commits; checks with results.
