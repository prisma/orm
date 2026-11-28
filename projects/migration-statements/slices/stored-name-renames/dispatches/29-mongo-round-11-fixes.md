# Dispatch 29 (MongoDB): fixes from the whole-branch drive code review, round 11

**Reviews to fix:** `projects/migration-statements/slices/stored-name-renames/reviews/pr2-round-11/system-design-review.md` (A39 to A41, and the two points routed to the code pass) and `code-review.md` (F01 to F05). Probes are in that folder (`sd-probe.*`, `cr-probe.*`). **Design:** `design-move-bypass.md` in the slice folder. **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-494725`. **Branch:** `gandhi-65/tml-3840-mongo-stored-name-renames`. **Tier:** Opus, medium effort.

Keep notes in `wip/mongo-stored-names/d20-progress.md`. The rules of dispatch 28 hold:

- run only the test and journey files you change, one per command;
- change nothing under `packages/1-framework` beyond `3-tooling/cli`;
- no AI attribution in commits;
- do not push;
- you may build.

## Fix

1. **A39. Field renames count the models the destination contract stores in the collection, as ADR 324 says the other rewrites do.**
   - Today `planFieldRename` counts the models of the origin contract, so it misses a model that moves into the collection. Count from the destination, as `rewriteRefusals` does for fills, casts, removals and value rewrites.
   - Then remove `twoPlans`: its field, its text and the inputs only it used. The variant-route branch of F01 goes with it.
   - Tests, red first: probes K1, K2 and K7 from the system-design review become planner tests. Also add one planner test per rewrite kind, showing that a rewrite of another model on the target that would reach the moved documents is refused. This covers F03, including enum value replacements in the statement route.
   - Run the existing shared-collection and statement planner files, and report any test whose result changes, with the reason.
   - If counting from the destination changes plans outside the move routes in a way ADR 324 does not support, stop and tell me.
2. **Correct dependency 4 in the design, ADR 188 and the route text.** It has three parts:
   - the target's rewrites come after the move;
   - a rewrite of another model that would reach the moved documents is refused;
   - the moving model's own rewrites in the target reach the moved documents, which is right (probe K4).
3. **A40. Each moving model gets its own field stages**, with one copy per model when their stages differ. Move `fieldStages` out of `DocumentMoveOrder` and into a per-model part of the move. Tests: probes K5 and K6.
4. **A41.** `documentMoveOrder` and `planCalls` build the input to `collectionPlanOf` with one shared builder, `comparableIndexes` included.
5. **F02.** When the moving model is a variant in the target, the copy also sets its discriminator value. Use a `$set` stage for it, printed with the field stages.
6. **F04.** A stated field rename of the moving model (`--rename User.name:Member.fullName`) is written by the copy's stages.
7. **F05.**
   - Run a copy with `$set`/`$unset` stages to the end in `runner-document-moves.test.ts`, and read the documents back.
   - Add a planner test proving that the assertion that the source collection is not renamed cannot be reached.
   - Make the assertion compare the right collection name in the variant route.
8. **Routed from the design pass.**
   - The runner's bypass refusal says "operations that already ran are skipped". That is not true for the move, which has no checks and runs again on every apply. Word it so it is true for both a rewrite and a copy.
   - When the plan without the statement is itself refused, `leftOutMove` falls back to the wrong schema. Make it give the right facts, or no move route, with a test.

## Done when

- `mise exec -- pnpm build` is clean.
- Typecheck and lint pass in every touched package, `test/integration` included.
- `mise exec -- pnpm lint:deps`, `lint:ratchets`, `lint:docs`, `fixtures:check` and `check:upgrade-coverage --mode pr` pass.
- Every test and journey file you change passes, each run on its own. Each behaviour change is red before the fix.
- `git diff --stat origin/main -- packages/1-framework` lists only files under `3-tooling/cli`.

## Report

Plain English, short:

- per item, what changed and which test was red first;
- every existing test whose result item 1 changed;
- the commits;
- each check, with its result.
