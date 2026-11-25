# Dispatch 31 (MongoDB): fixes from the whole-branch drive code review, round 13

**Reviews to fix:** `projects/migration-statements/slices/stored-name-renames/reviews/pr2-round-13/code-review.md` (F01 to F04) and `system-design-review.md` (A47 to A52, plus the points it routed to the code pass). Probes are in that folder. **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-494725`. **Branch:** `gandhi-65/tml-3840-mongo-stored-name-renames`. **Tier:** Opus, medium effort.

Keep notes in `wip/mongo-stored-names/d22-progress.md`. The rules of dispatch 28 hold:

- run only the test and journey files you change, one per command;
- change nothing under `packages/1-framework` beyond `3-tooling/cli`;
- no AI attribution in commits;
- do not push;
- you may build.

## The root cause, and the fix it calls for

Rounds 11 to 13 each found a case where the move route's facts come from a partial re-plan (`planWithout` re-runs only `planStatements`). They are F01 and A47 this round, and A43 and the `twoPlans` gap before. The route then describes a plan that differs from the one the user will get.

So the route's facts come from **the planner's full result for the plan the route tells the user to make**:

- the same `plan()` entry point;
- the same contracts and options;
- the statements the route leaves out removed.

That plan is the one `migration plan` will produce. If it is refused, the route gives no move and says why, as the existing fallback text does. If it succeeds, the placement, bypass, copies and dropped fields are read from its calls and schemas.

Re-planning with fewer statements always ends, since each nested plan has fewer statements. If calling the full planner from inside a refusal is not a contained change, stop and tell me before building another approach.

## Fix

1. **F01 and A47.**
   - Build the route from the full plan without the statements.
   - Leave out every refused model rename out of the same source collection together, with their field statements, and give one move for each destination collection.
   - The refusals of one change share that route. Print it once, and have the other refusals point to it by the statement it was printed under.
   - Tests:
     - probe Q6 (a cast that refuses the plan gives no move);
     - probe P3 (two destinations, one route with two moves);
     - a test that the route is printed once.
2. **F02, A48 and QA 18.** Every rewrite refusal that a model in the target blocks (field rename, cast, fill, backfill, removal, enum value replacement, embedded key rename) names the order that works, from one shared text function.
   - The text must be true for the case. When the model is new to the collection, it says to do the change in an earlier migration, before the model is added. When the model was already there and only starts storing the field (probe Q1), it says what does work, or says nothing it cannot back up.
   - Correct the ADR 324 sentence to match the code.
   - Tests: Q1 and P1.
3. **F03 and A49.** No route sends the user in a circle. The merged route and the variant route name every statement to leave out. A field statement's refusal does not tell the user to add a `--rename` they already passed.
   - Tests: Q2, Q3 and P5. Each follows the printed advice one step and checks the next refusal does not undo it.
4. **F04.** A test proving that a validator rejection other than error 121 does not get the copy text. Red with the check removed.
5. **A50.** Print the copy steps with `jsonToTsSource` from `@internal/ts-render`, the function that renders the rest of `migration.ts`, and delete `javaScriptText`. Keep probe Q4/R1's round-trip as a test.
6. **A51.** Give the two meanings of `from` two names: the origin collection name on the input, and the name of the collection when the move runs on `DocumentMove`.
7. **A52.** On error 121 the runner checks the migration's later operations itself. If a later validator update replaces the target's validator, it says to add `bypassDocumentValidation: true`. Otherwise it says to fix the pipeline. Unit test for each.
8. **Routed from the design pass to the code pass.**
   - The variant route lowercases the first letter of another function's text: give that function a form that fits mid-sentence instead.
   - `copyTargetOf` ignores the `db` in `$merge` and calls `$out` a copy. Handle `{ into: { db, coll } }`, and word the `$out` case correctly. Add tests.

## Done when

- `mise exec -- pnpm build` is clean.
- Typecheck and lint pass in every touched package, `test/integration` included.
- `mise exec -- pnpm lint:deps`, `lint:ratchets`, `lint:docs`, `fixtures:check` and `check:upgrade-coverage --mode pr` pass.
- Every test and journey file you change passes, each run on its own. Each behaviour change is red before the fix.
- `git diff --stat origin/main -- packages/1-framework` lists only files under `3-tooling/cli`.

## Report

Plain English, short:

- per item, what changed and which test was red first;
- whether the full re-plan was a contained change;
- the commits;
- each check, with its result.
