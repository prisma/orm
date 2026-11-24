# Dispatch 20 (MongoDB): fixes from the whole-branch drive code review, round 4

**Reviews to fix:** `projects/migration-statements/slices/stored-name-renames/reviews/pr2-round-4/code-review.md` (F01 to F03) and `system-design-review.md` (A22 to A24); probes in that folder and in `wip/mongo-stored-names/probes/cr4.test.ts` · **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-494725` · **Branch:** `gandhi-65/tml-3840-mongo-stored-name-renames` (tip `77bd45cb8d`) · **Tier:** Opus, medium effort

Notes in `wip/mongo-stored-names/d11-progress.md`. The rules of dispatch 10 hold: run only test and journey files you change, one per command; nothing under `packages/1-framework` beyond `3-tooling/cli`; no AI attribution in commits; do not push. List every site checked for each class in your notes.

1. **F01. A removed root model blocks no rename, fields included.** Dispatch 18 made a model the destination removes stop blocking a collection rename; the shared-collection check for field renames (`planFieldRename`, `mongo-statement-planning.ts` around lines 832 to 853) still counts it. A model the destination removes does not block a field rename or a field rename statement, and no refusal names a model as stored in a collection the destination does not store it in. Search for every other check that counts "other models in this collection" from the origin contract (field renames, stored-key renames, value replacements, fills, the overlap check) and make them agree: the models that count are the ones the destination keeps. Probes P4, P5, P10 and P11 become tests.
2. **F02.** Remove the root-model skip from `embedRelationRefusals` (dispatch 19 added it; a refusal is not a rename). Probe P1 becomes a test: the embedded relation stored-name change on a root model paired only by storage is refused, as at round 3's tip.
3. **F03, A22, A23. Docs say what the code does.**
   - A root model leaving a shared collection: no rename is planned, and its fields' changes are planned as on main (a field whose stored name changes is unset and asked about; refused when the other model holds the same key). ADR 324, the Migration System doc and `deferred.md` say so.
   - A root model paired only by storage: no rename with no statement; its fields are matched by name for fills and type changes as on main. Correct the ADR and doc sentence "its fields are not paired", and add the fills and type-change consequence (round 4 probe Q1) to the 2026-11-19 `deferred.md` entry about a removed model whose storage a new model takes.
   - The spec's pairing table: pairing by storage is "the rule of prisma/orm#31061, unchanged", for root models and variants, with renames derived only for variants. ADR 324 gives the two reasons in one sentence each: pairing by storage only pairs a model that no statement and no same name pairs, and the plan still asks about what it removes; a variant's documents carry its discriminator value, so they are known to be that variant's, while a root model's are not.
4. **A24.** `destinationModelOf` returns how it paired a model (statement, same coordinate, storage), and every consumer that treats a root model paired by storage differently reads that, not its own copy of the check. Rename one of the two private `modelsStoredIn` functions so each name has one meaning. If moving pairing next to `modelRenamesOf` is more than a contained change, record it in the existing `deferred.md` entry on how MongoDB passes its renames.
5. **Missing test.** A variant paired by storage whose field changes only `@map` gets the field rename (ADR 324: fields pair through their model's pair, whichever rule made it).

## Done when

- `mise exec -- pnpm build` is clean; typecheck and lint pass in the MongoDB target.
- `mise exec -- pnpm lint:deps`, `lint:ratchets`, `lint:docs` pass.
- Every test file you change passes, each run on its own; behaviour changes red before the fix.
- `git diff --stat origin/main -- packages/1-framework` lists only files under `3-tooling/cli`.

## Report

Plain English, short: per item, what changed and the test red first; the sites checked; commits; checks with results.
