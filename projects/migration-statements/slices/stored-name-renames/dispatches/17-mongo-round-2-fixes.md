# Dispatch 17 (MongoDB): fixes from the whole-branch drive code review, round 2

**Reviews to fix:** `projects/migration-statements/slices/stored-name-renames/reviews/pr2-round-2/code-review.md` (new F01 to F05) and `system-design-review.md` (A11 to A16); probes in `wip/mongo-stored-names/probes/cr2.test.ts` · **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-494725` · **Branch:** `gandhi-65/tml-3840-mongo-stored-name-renames` (tip `ef7ec73e06`) · **Tier:** Opus, medium effort

Notes in `wip/mongo-stored-names/d8-progress.md`. The rules of dispatch 10 hold: run only test and journey files you add or change, one per command; nothing under `packages/1-framework` beyond `3-tooling/cli`; no AI attribution in commits; do not push. Fix the class, not the instance, and list in your notes every site checked for each class: each review round so far has found a fix made at one site and missed at another.

## Decisions taken by the orchestrator

1. **Boolean enum swap: no hand-written route (F02, A13, A16, F04 boolean part).** ADR 324 already states the SQL family's rule: "A refusal offers only a route a user can follow to the end on every target that prints it… So neither enum refusal offers a hand-written migration that rewrites the values itself." A boolean swap cannot be made safe to run again after a stop (a swap has no state a check can read), on either command. So match SQL: a boolean enum whose two values trade places is refused with "keep the stored values of this enum in the contract", and no mongosh or `dataTransform` route. Remove `booleanSwapRoute` and its printed forms, the live tests that ran them, and the docs that describe them (ADR 324, Migration System doc, error reference, upgrade note). Add one CLI journey that shows the refusal, using a TypeScript contract fixture (`useFixture`, as other MongoDB journeys do), with JSON error output asserting no `refusedStatement`.
2. **The documents a root model leaves behind (F01, F05, A11).** Root models with no discriminator that share a collection all read every document in it.
   - **Which models.** The set of models that leave the collection is computed from the one pairing owner (`destinationModelOf`/`originModelOf` over the rename list, with pairing by storage last), not a second copy of the pairing rules. Probes P2v (the destination replaces `Admin` with `Boss` and `User` moves out: asked about `User`) and P4v (a model paired by storage: no false question) become tests.
   - **A model that moves out** (paired, and the destination stores it in another collection) starts with no documents: ask about it. Attach the question to the operation that gives the model its new storage: the create of its new collection, or, when that collection already exists, its validator change. When the plan has neither, refuse the plan with the route: keep the model in the shared collection, or move its documents with a hand-written migration first and plan again. The question's text says plainly that the documents stay in the shared collection and are still read by the other models there, and that `--delete <Model>` accepts that the model starts with none; it deletes nothing. Say the same in ADR 324.
   - **A model the destination removes** from such a collection: nothing is destroyed and the other root models still read the documents, as before. Ask nothing, as today. Make the shared-collection refusal text of `--rename` (R6) and the upgrade note say what the plan without the statement actually does in each case, and follow R6's leave-out route to the end in a journey (F04), including whether the next question offers the same rename again.
   - Probe P5 (no validators, `User` removed, empty plan) becomes a test of the removed case.
3. **F03.** A takeover refusal whose stored name belongs to an embedded relation does not offer "change its field name" (that change is refused in this release). It offers only the branches that work.

## Also fix

4. **A12.** Rename the new `StoredPlace` type in `mongo-rename-conflicts.ts` so the target has one type per name.
5. **A13.** The spec's MongoDB rows: a root model that leaves a shared collection is asked about (as in decision 2), and rule 1 of "Storage is renamed only when all of it moves" carries the MongoDB exception for a removed root model with no discriminator.
6. **A14.** `collectionControlPolicy` lives in a module about model storage (as SQL's `model-storage.ts`), not in `mongo-storage-renames.ts`.
7. **A15.** `PlannedRewrite` says where a rewrite came from in one field. A `--backfill` or `--convert` rewrite does not read as a contract change.
8. **A16.** The freed-name refusal uses `ONE_AT_A_TIME`; no route text is written out where a helper exists.
9. **A01 remainder and A05 remainder.** Remove the two `fieldRenames: []` placeholders if the rename list can carry them; pass the renames as one value as SQL's `StorageRenames` does, if that is a contained change; otherwise record each in `deferred.md` with the reason. Record that `plannedCollectionChanges` both plans and refuses, unlike SQL.

## Done when

- `mise exec -- pnpm build` is clean; typecheck and lint pass in every touched package, including `test/integration`.
- `mise exec -- pnpm lint:deps`, `lint:ratchets`, `lint:docs`, `check:error-reference`, `check:upgrade-coverage --mode pr` pass.
- Every test and journey file you add or change passes, each run on its own; behaviour changes red before the fix.
- `git diff --stat origin/main -- packages/1-framework` lists only files under `3-tooling/cli`.

## Report

Plain English, short: per item, what changed and the test red first; the sites checked for each class; journeys added; commits; checks with results.
