# Dispatch 8: embedded model fields are not planned as top-level fields

**Review:** `../reviews/code-review.md`, dispatch 7 · **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/pollyanna-30-context-6ee51c/wip/wt-4b` · **Branch:** `tml-3538-mongo-value-object-statements`

Dispatch 7 made `collectionOfModel` follow `owner`, so an embedded model resolves to its owner's collection. The planner still treats the embedded model as a root model, so its rewrites target top-level fields of the owner's documents. Example: `User` in `users` embeds `Address` (`owner: 'User'`). Removing `Address.street` plans "Remove field street from collection users", which unsets a top-level `street` in every user document. A rename statement for `Address.street` plans a top-level rename. Convert and backfill scaffolds would write top-level filters. The real values live under the embed field (`addresses.street`). PR 2 builds rewrites inside embedded documents; until then nothing may rewrite them as top-level fields.

## Fix

Keep `collectionOfModel` as it is. Add one check, "this model is embedded" (the model or a model in its base chain has an `owner`), and use it:

1. `planFieldRemovals` skips an embedded model's fields: no unset, no data-loss question.
2. `planFieldStatement`, `convertTransform` and `backfillTransform` refuse a field of an embedded model, naming it and saying embedded model fields are not rewritten in this release.
3. Casts and fills (`castField`, `fillField` planning) skip embedded model fields the same way, so they plan nothing for them.
4. Check `destinationModelOf`'s storage match for embedded models.
5. The validator change's document check still covers these documents, so a change to an embedded model field fails at apply until the documents fit. Add embedded model field changes (type change, removal, new required field) to the `documentsNotRewritten` warning so the user is told before the apply.

## Tests

Write each test first and see it fail on the current code. Planner tests with `User` embedding `Address`: removal, rename statement, convert, backfill, type change (no cast), new required field (no fill), and the warning for each. One runner or journey test that applies a removal of an embedded field and shows top-level fields of the owner's documents are untouched.

## Rules

As in the earlier briefs. Commit with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"` and no AI attribution; stage files explicitly; do not push.

## Done when

The tests above were red first and pass; the checks in the plan's "Checks for every dispatch" pass; every MongoDB journey passes.

## Report

Plain English, short sentences: what you changed, the refusal and warning texts, the tests that were red first, the checks, and the commits.
