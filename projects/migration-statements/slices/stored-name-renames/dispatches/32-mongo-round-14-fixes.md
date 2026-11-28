# Dispatch 32 (MongoDB): fixes from review round 14 and QA round 6

**Reviews to fix:** `projects/migration-statements/slices/stored-name-renames/reviews/pr2-round-14/code-review.md` (F01 to F04) and `system-design-review.md` (A53 to A58, and the point it routed to the code pass). Probes are in that folder. **QA:** `projects/migration-statements/manual-qa-reports/2026-11-25-qa-stored-names-mongo-round-6.md`, findings 16 (rest), 17 (rest) and 19 to 23. **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-494725`. **Branch:** `gandhi-65/tml-3840-mongo-stored-name-renames`. **Tier:** Opus, medium effort.

Keep notes in `wip/mongo-stored-names/d23-progress.md`. The rules of dispatch 28 hold:

- run only the test and journey files you change, one per command;
- change nothing under `packages/1-framework` beyond `3-tooling/cli`;
- no AI attribution in commits;
- do not push;
- you may build.

## The one change at the centre

Both review passes found the same thing (code review F01 and F02, system-design review A53 and A54):

- **Lost routes.** When refused statements sit in different collections, each refusal leaves out only its own group, so no refusal prints a move. A user who follows them all gets a plan that succeeds and leaves the documents behind.
- **Planning time.** The nested re-plans grow with the factorial of the number of refused statements.

So:

1. Leave out **every statement the shared-collection rule refuses in this run**, with their field statements, in one re-plan.
2. Build one route from that plan's full result, covering every move it needs, with one move per source and destination.
3. Print that route once. Every other refusal points to it.
4. The nested plan builds no route text: give it a `planWithout` that returns its result without building routes. There is then one level of re-planning, and its cost is linear.

Tests:

- probe TWOSOURCES: one route, both moves, and following it keeps every document;
- a test that 8 refused statements plan in well under a second;
- the existing grouping tests, updated.

## Fix

5. **F03.** When every model leaves the source collection (probe ALLLEAVE), the plan the route sends the user to asks about dropping that collection. Say plainly that the move copies the documents before the drop runs, so answering with the `--delete` the question names is safe. Remove the contradiction with the sentence saying `--delete` deletes the data. Add a planner test, and follow the route to the end in a runner test.
6. **F04 and A56.** Print each copy call on its own lines after the sentence that introduces it, indented consistently, not split inside a sentence.
7. **A55.** The runner says a later validator removal "checks the moved documents". For a removal, say what is true.
8. **Routed to the code pass.** `laterValidatorUpdate` finds a validator update on the target after the target collection is renamed. Add a unit test.
9. **A57.** Name the `Arrival` values after what happens to the model, for example `'joinsCollection' | 'startsStoringField'`.
10. **A58.** A field statement's refusal points straight to the refusal that prints the route, not to one that only points on.
11. **QA 19.** Name statements in the form the CLI accepts. Check `--rename` parsing for the field form, and use that same form in every printed statement. Leaving out only the model statement must not send the user back to it.
12. **QA 20.** A route with two moves says they go into one `migration.ts` and one apply.
13. **QA 21.** A copy the validator rejects names the document MongoDB reports in the error (its `_id`), when the error gives one.
14. **QA 22.** With `--rename`, a fill refusal that the route mentions is printed, or the route stops mentioning it.
15. **QA 23.** The route says that `$unset` drops that field's values.
16. **QA 16 (rest).** The stop at the validator check no longer says "operations that already ran are skipped" where that is not true for the move.
17. **QA 17 (rest).** Each route is short paragraphs: placement, the copy calls, the delete, how to apply, what to do on a stop.

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
