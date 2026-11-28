# Dispatch 18 (MongoDB): fixes from the whole-branch drive code review, round 3

**Reviews to fix:** `projects/migration-statements/slices/stored-name-renames/reviews/pr2-round-3/code-review.md` (new F01 to F04) and `system-design-review.md` (A17 to A21), with probes in that folder and in `wip/mongo-stored-names/probes/cr3.test.ts` · **Spec:** `projects/migration-statements/slices/stored-name-renames/spec.md` · **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-494725` · **Branch:** `gandhi-65/tml-3840-mongo-stored-name-renames` (tip `d20a27581d`) · **Tier:** Opus, medium effort

Notes in `wip/mongo-stored-names/d9-progress.md`. The rules of dispatch 10 hold: run only test and journey files you add or change, one per command; nothing under `packages/1-framework` beyond `3-tooling/cli`; no AI attribution in commits; do not push. List every site checked for each class in your notes.

## Decisions taken by the orchestrator, and why

**1. Back to the spec for a root model that leaves a shared collection.** The spec's edge-case table says "One of two MongoDB root models that share a collection moves | Not a rename. Planned as today", and its "Deliberately out" list puts "a model leaving a shared collection" among the data migrations statements do not offer. Rounds 1 and 2 added a question about the documents such a model leaves behind; each round's fix exposed new cases (wrong operation to attach to, empty plans, `db update` after a hand move, a key unset in the collection the model leaves, a validator that stops the apply). That mechanism was not in the design. Remove it:
   - Delete `leftBehindOf`, the left-behind question and its no-operation refusal, their texts, and `mongo-planner.left-behind.test.ts`'s tests of them. The plan for this case is what `origin/main` plans: the storage diff with its own questions.
   - Keep the planner tests that show no rename is planned and no document of another model moves (the case the spec asks for), and the tests from round 2 that pin pairing through the one owner.
   - Journey C1 shows today's plan for this case and reads both models' documents back afterwards, asserting what is actually there.
   - Record in `projects/migration-statements/deferred.md` that a root model moving out of a collection it shares with another root model, with no discriminator, starts empty in its new collection with no question, because its documents cannot be told apart from the other model's; that this predates this work (cite the `origin/main` code); that the spec defers it as a data migration; and that a fix needs a design (a question needs an operation to attach to, and a framework loss kind for data a plan leaves in place may be needed).
   - Remove the ADR 324, spec, Migration System doc and upgrade-note text that describes the left-behind question.

**2. A removed root model does not block a collection rename (A18).** Root models with no discriminator that share a collection already read every document in it. When one is removed and another renames the collection, every remaining model reads exactly the documents it read before, so nothing is misread that was not already. Remove the `removed` kind from `sharedCollection` and the MongoDB exception to rule 1 of "Storage is renamed only when all of it moves". This matches SQL and the spec: an object the destination removes does not block the rename. The round-1 regression tests for this case change to expect the rename. `--rename User:Member` in that situation plans again.

**3. Pairing by storage is for variants only (A17).** ADR 324's pairing table says "else, for MongoDB variants only, the same storage", and the design notes say the planner "never guesses identity from storage". `destinationModelOf` also pairs root models by storage, which now plans field renames on that guess. Restrict pairing by storage to variants. First check `origin/main`: if a test from prisma/orm#31061 pins root-model pairing by storage, say so in your report, change it to the ADR's rule, and record in your notes what a plan for that case does after the change (a removed root model and a new root model in one collection are then two models; this is the case the operator decided on 2026-11-19 should ask about the removed model, which is not built here — add a `deferred.md` cross-reference if the entry exists, or one entry if not).

## Also fix

4. **F02.** A takeover refusal whose name an embedded relation holds offers only routes that work to the end. Removing the relation plans nothing and leaves its key in the documents, so do not offer it. Offer keeping the field's stored name. Probes Q9 to Q12 become tests.
5. **`--rename` on a shared collection (R6).** Its text says truthfully what the plan without the statement does after decision 1. The upgrade note matches. Journey R6 asserts that, with no hand deletion of documents unless the text tells the user to do it.
6. **A21 and the A14 remainder.** One function finds a model's documents' collection (`documentsCollectionOf` and `documentCollectionOf` become one), one place checks "root model", and `collectionControlOf` moves to `mongo-control-policy.ts`.
7. **A20 class.** Every hand-written route says which command it is for, with one lead-in, and none tells a `db update` user to write a migration.

## Done when

- `mise exec -- pnpm build` is clean; typecheck and lint pass in every touched package, including `test/integration`.
- `mise exec -- pnpm lint:deps`, `lint:ratchets`, `lint:docs`, `check:error-reference`, `check:upgrade-coverage --mode pr` pass.
- Every test and journey file you add or change passes, each run on its own.
- `git diff --stat origin/main -- packages/1-framework` lists only files under `3-tooling/cli`.
- `git grep -n -i "left behind\|leftBehind" -- packages test docs` finds nothing but the `deferred.md` entry.

## Report

Plain English, short: per item, what changed and the test red first or changed; what `origin/main` pinned for root-model pairing by storage and what the plan does now; the deferred entries; commits; checks with results.
