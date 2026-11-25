# Dispatch 30 (MongoDB): fixes from review round 12 and QA round 5

**Reviews to fix:** `projects/migration-statements/slices/stored-name-renames/reviews/pr2-round-12/system-design-review.md` (A42 to A46) and `code-review.md` (F01, F02). Probes are in that folder. **QA:** `projects/migration-statements/manual-qa-reports/2026-11-25-qa-stored-names-mongo-round-5.md`, findings 15 to 18. **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-494725`. **Branch:** `gandhi-65/tml-3840-mongo-stored-name-renames`. **Tier:** Opus, medium effort.

Keep notes in `wip/mongo-stored-names/d21-progress.md`. The rules of dispatch 28 hold:

- run only the test and journey files you change, one per command;
- change nothing under `packages/1-framework` beyond `3-tooling/cli`;
- no AI attribution in commits;
- do not push;
- you may build.

## Fix

1. **F01.** The copy keeps fields the destination model drops, so the target's closed validator stops the apply. Add the dropped stored names to the copy's `$unset`, and say in the route text that the copy drops them. Tests: a unit test, a planner test, and the runner case from the review, red first.
2. **F02 and A42.** Field renames now count a brand-new model in the collection: a field `@map` change next to a new model that stores the same name is refused, where `main` planned it. Keep that behaviour.
   - Pin it with planner tests: probes N1 and N2.
   - Add one sentence to ADR 324 saying why: the planner cannot tell a new model with no documents from one whose documents a hand-written move copies in.
   - Make the refusal text say what works: rename the field in an earlier migration, before the model is added.
3. **A43.** When several stated renames move together, each refusal leaves out every statement of the change, not only its own, so the move steps print. Planner test: probe N3.
4. **QA 15.** "Leave out this statement" names every statement to leave out, including field `--rename` statements of the moving model. The text must stay true when they are left out (check against item 3).
5. **QA 16.** A copy that fails on the target's validator gets a runner failure that calls it a copy, not "the update", and says what to do: add `bypassDocumentValidation: true` when a later validator update in the plan replaces the validator, or fix the documents the pipeline writes.
6. **QA 17.** Make the route text easier to read:
   - split it into short sentences;
   - print the stages in the same JavaScript style as the rest of the example, not as JSON;
   - reword the variant route's "This assumes that first plan makes every change…" sentence so it says plainly what the user must put in the first plan.
7. **QA 18.** The refusal for a target rewrite that would reach the moved documents names the order that works, as item 2 does.
8. **A44 to A46**, and the wording point routed to the code pass:
   - the move's source and destination are held in the same place;
   - the filter sentence says that each copy needs its own filter;
   - `collectionPlanSchemasOf` stops taking a `fromDatabase` value its origin already holds;
   - the leave-out text agrees in number when several models move.

## Done when

- `mise exec -- pnpm build` is clean.
- Typecheck and lint pass in every touched package, `test/integration` included.
- `mise exec -- pnpm lint:deps`, `lint:ratchets`, `lint:docs`, `fixtures:check` and `check:upgrade-coverage --mode pr` pass.
- Every test and journey file you change passes, each run on its own. Each behaviour change is red before the fix.
- `git diff --stat origin/main -- packages/1-framework` lists only files under `3-tooling/cli`.

## Report

Plain English, short:

- per item, what changed and which test was red first;
- the commits;
- each check, with its result.
