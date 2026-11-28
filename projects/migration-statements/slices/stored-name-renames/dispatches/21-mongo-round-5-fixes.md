# Dispatch 21 (MongoDB): fixes from the whole-branch drive code review, round 5

**Reviews to fix:** `projects/migration-statements/slices/stored-name-renames/reviews/pr2-round-5/code-review.md` (F01, F02) and `system-design-review.md` (A25, A26); probes in that folder and in `wip/mongo-stored-names/probes/cr5*.test.ts` · **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-494725` · **Branch:** `gandhi-65/tml-3840-mongo-stored-name-renames` (tip `15be0871ba`) · **Tier:** Opus, medium effort

Notes in `wip/mongo-stored-names/d12-progress.md`. The rules of dispatch 10 hold: run only test and journey files you change, one per command; nothing under `packages/1-framework` beyond `3-tooling/cli`; no AI attribution in commits; do not push. List every site checked.

1. **A25. One definition of "the other models whose documents share this collection".** Field renames and variant rewrites count origin models the pairing keeps, wherever the destination stores them; value replacements, stored-key rewrites and fills count models the destination stores in the collection. Use one function, with the destination's definition: the other models are those the destination stores in that collection (origin models the destination removes or moves elsewhere do not count, as the ADR's reason for removed models says: the models that remain read the documents they read before). Keep the takeover holders as they are (a removed model's keys still hold data). Round 5 probes R1 to R3 become tests: `Admin.name`'s `@map` change while `User` moves out of `people` is planned as a rename, and no refusal names `User` as stored in `people`. Update the `deferred.md` entry on a root model moving out of a shared collection if its examples change.
2. **F01.** The takeover refusal in `fieldRenameConflict`, when the holder is a field of a root model the destination removes from a shared collection, says that removing the model does not free the stored name (its documents keep the key, as the embedded relation case already says) and offers only the routes that work: keep the model and remove only its field first (an unset with a question), or keep the stored name. Tests of the text and of the two-plan route followed to the end (probes A1, A1b).
3. **F02.** Tests for the variant `sharedCollectionRefusal` with removed root models: a variant delete when the other root model is removed (planned and asked about) and when it stays (refused), and the same two cases for a discriminator value replacement (probe A5). Red when the filter is removed.
4. **A26.** Rename `pairRenamesWithNoStatement` to a name that reads as a yes-or-no check (for example `givesRenamesWithNoStatement`). Update the `deferred.md` entry on how MongoDB passes its renames: it now names three places built with an empty field rename list, including the `kept` closure in `planStatements`.
5. **Deferred item from the code review.** The refusal text for a removed model that a new model pairs by storage names the origin model; leave it, as the review recommends.

## Done when

- `mise exec -- pnpm build` is clean; typecheck and lint pass in the MongoDB target.
- `mise exec -- pnpm lint:deps`, `lint:ratchets`, `lint:docs` pass.
- Every test file you change passes, each run on its own; behaviour changes red before the fix.
- `git diff --stat origin/main -- packages/1-framework` lists only files under `3-tooling/cli`.

## Report

Plain English, short: per item, what changed and the test red first; sites checked; commits; checks with results.
