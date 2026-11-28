# Dispatch 23 (MongoDB): fixes from the whole-branch drive code review, round 7, and manual QA round 2

**Reviews to fix:** `projects/migration-statements/slices/stored-name-renames/reviews/pr2-round-7/code-review.md` (F01, F02) and `system-design-review.md` (A29 to A31, and the E2 note); probes in that folder and in `wip/mongo-stored-names/probes/cr7.test.ts` · **QA report:** `projects/migration-statements/manual-qa-reports/2026-11-24-qa-stored-names-mongo-round-2.md` (findings 7 and 8), scratch in `wip/qa-mongo/r*` · **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-494725` · **Branch:** `gandhi-65/tml-3840-mongo-stored-name-renames` · **Tier:** Opus, medium effort

Notes in `wip/mongo-stored-names/d14-progress.md`. The rules of dispatch 10 hold: run only test and journey files you change, one per command; nothing under `packages/1-framework` beyond `3-tooling/cli`; no AI attribution in commits; do not push. List every site checked.

1. **F01. The shared-collection route moves the documents first.** The route for `--rename` on a shared collection tells the user to add the move (`dataTransform` with `$match`/`$merge`, then `deleteDocuments`) right after the operation that creates the new collection, before any other operation that touches the old collection; otherwise a field rename, unset or value rewrite of the staying model reaches the moving model's documents first. Probes Q1 (`Admin.email` gets `@map("mail")` in the same change) and Q3 (`--delete Admin.email`) become cases of journey T5 or planner tests that check the text; follow the route to the end in at least one of them and read the documents back.
2. **QA 7. If that route stops after the create.** A migration that creates a collection cannot be run again after a later operation stops (TML-3929, on `main` too; its fix changes the operation's after-check and is a separate change). The runner's drift advice can then lead a user to drop the new collection, which holds the moved documents. In the route text, say in one sentence what to do if the apply stops after the new collection is created: do not drop it, since it holds the moved documents; remove the create from `migration.ts`, fix what stopped the apply, and run again. Follow that in a test or journey (the QA runner did it by hand: it finished with nothing lost or duplicated).
3. **A30 and QA 8. The variant refusal next to a model that moves out.** "Plan this change again" loops, because the refusal is decided from the contracts. Give the route that works, and follow it to the end in a test: two plans, first move the root model out with the variant kept (and move its documents, per item 1's route under `migration plan`, or by hand under `db update`), apply; then make the variant change and plan again.
4. **F02.** When one root model moves out and another stays, the variant refusal's advice covers every model that blocks it, so following it does not lead to a second refusal (probe Q2).
5. **A29.** ADR 324 and the Migration System doc give the real reason the two sharing rules differ: rewrites checked by `rewriteRefusals` (renames, value replacements, removals, casts, fills) have always counted the models the destination stores in the collection; variant deletes and discriminator replacements count every model the destination keeps, because they select documents by discriminator value and a moving model's documents left behind can match it. Widen the doc comment on `sharesCollectionInDestination` to every rewrite `rewriteRefusals` checks. Add to the `deferred.md` entry on a model moving out of a shared collection that removals, casts and fills of the staying model also reach the documents left behind (probe P3: `Admin.status` removed while `User` moves out unsets `status` in `User`'s documents, asked about only as `Admin.status`; same on `origin/main`).
6. **A31.** Rename `keepsDocumentsOf` to say what it tests (for example `destinationKeepsModel`), and use it in the takeover call in `planStatements` instead of the inline test.
7. **E2.** The refusal of an enum value rename that moves a discriminator value says "replace" in its summary, matching its explanation.

## Done when

- `mise exec -- pnpm build` is clean; typecheck and lint pass in every touched package, including `test/integration`.
- `mise exec -- pnpm lint:deps`, `lint:ratchets`, `lint:docs`, `check:upgrade-coverage --mode pr` pass.
- Every test and journey file you change passes, each run on its own; behaviour changes red before the fix.
- `git diff --stat origin/main -- packages/1-framework` lists only files under `3-tooling/cli`.

## Report

Plain English, short: per item, what changed and the test red first; sites checked; commits; checks with results.
