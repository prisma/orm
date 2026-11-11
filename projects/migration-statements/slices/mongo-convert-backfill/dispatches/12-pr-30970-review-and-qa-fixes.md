# Dispatch 12: fixes from the review and QA of PR #30970

**Reviews:** `../reviews/pr-30970/code-review.md` (F01 to F05) and `../reviews/pr-30970/system-design-review.md` (S01 to S08) · **QA:** `projects/migration-statements/manual-qa-reports/2026-11-10-qa-4b-pr1-final.md` (problems 1 to 5) · **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/pollyanna-30-context-6ee51c/wip/wt-4b` · **Branch:** `tml-3538-mongo-value-object-statements`

Read the three files first. Each code fix with a test that fails without it. Leave the CLI text in `packages/1-framework` and the names alone; they wait for Will.

## Correctness

1. **F01. A field that can hold any value gets no cast.** `castOptions` in `mongo-type-changes.ts` reads an empty list of old types as "every old type can be cast", so `Bson` to `Boolean` or `Int` offers `--delete` and turns `"false"` into `true`. When the old types are unknown (a `Bson` field, or a validator property with no `bsonType`), there is no cast: offer `--convert` only. Tests with and without an origin contract.
2. **F02. Read the discriminator correctly.** `discriminatorOf` in `validator-shapes.ts` cannot tell a one-value enum field from the discriminator, so such a field on a base hides every variant's discriminator. Read the discriminator as the property that is only `{ enum: [value] }` with no `bsonType`, as the derivation writes it. Tests: a base with a one-value enum field and two variants, without an origin contract, a variant cast filters on the right value and the runner names reasons from the right variant.

## Wrong advice

3. **F03.** When a planner rewrite's postcheck fails (`castField`, `fillField`, `renameField`, `unsetField`), `documentsStillMatchingFailure` says to change the update in `migration.ts`. Give that advice only to data transforms; a planner rewrite's failure says what is true. Runner test.
4. **F04.** In `rewriteFailure`, handle data transforms first for every error code, so an error in a user's update never gets the planner's advice. Correct `fieldRewriteOf`'s doc comment.
5. **QA 1.** When a `--delete` cast fails part way, the message also says that the documents already cast no longer fit the current validator, so the app's updates to them fail until a re-run finishes.
6. **QA 2.** Say "the old validator rejects such an update" only where it does: compare the fixed value the advice is about with the current validator, or word it as "may reject". Fix the skill reference's Prisma 6 item, which says a validator rejects the update when the collection has none.
7. **QA 3.** The skill reference says MongoDB refuses a field whose stored name contains `.`; say what actually happens.

## Shape (do before PR 2 copies it)

8. **S01. Operations say what they are.** The runner works out operations from command shapes (`castFieldOf`, `documentsCheckedBy`, `documentsStillMatchingFailure`). The factories new in this PR (`castField`, `fillField`, the early document check) write a typed description of the operation into its `ops.json` entry, and the runner reads that. Data transforms are known by their class. `renameField` and `unsetField` from 4a keep their `ops.json` exactly as it is, so committed migrations re-emit unchanged; the runner may keep reading `$rename` and `$unset` for those two. Record this in ADR 188.
9. **S02.** `backfillAdvice` repeats the planner's backfill refusal rules, and the copies differ (the runner counts `anyOf` roots; the planner uses `otherModelsReached`). One function, used by both.
10. **S03.** `migration.ts` writes the new validator twice, in the early check and in the validator change, and nothing keeps them equal. Render it once and refer to it from both, if the rendering supports a shared value; if it does not, make the early check refuse at build time when the two differ. Say which.
11. **S05.** One reader of the BSON types a property schema allows, in `validator-shapes.ts`, used by the runner (`allowedBsonTypes`) and the planner (`bsonTypesOf`). Today they disagree on `number`.
12. **S07.** Tell check sources apart by the command class's `kind`, not by the absence of a `command` key, in `isInspectionCheckSource` and the serializer.
13. **S08.** `FillFieldCall` and `CheckDocumentsCall` carry `collection` (and `field` where it applies) like `CastFieldCall`, so `callCollection` needs no special case. Remove the one-line `collectionOf` wrapper. Build `TypeChange`'s `CastFieldCall` outside the analysis.
14. **S04 and S06.** ADR 188 says the two opt-out edits are one opt-in. Say in ADR 188 that `checkDocuments: true` on `setValidation` also adds its existence precheck and applied postcheck, and why.

## Tests and output

15. **F05.** In the journeys' `verifiedAndSettled`, run an `updateMany` without `bypassDocumentValidation` on every collection the journey changed, and assert it succeeds.
16. **QA 5.** On an empty collection the output said `Applied 3 operation(s)` above four listed operations. Find out why (probably the early check counted as skipped) and make the count and the list agree, or say which were skipped.
17. **QA 4.** A type change on a field whose stored name contains `.` is neither asked about nor refused, so the user has no statement to answer with. Refuse such a type change at planning, naming the field, as other rewrites of such fields are refused.

## Rules

As in the earlier briefs: nothing in `packages/1-framework`; never the full integration suites; `mise exec --`; no `/tmp`; no bare `git stash`; no comments where code can say it; no bare `as`; no invented nouns (new property names in `ops.json` follow existing ones; list any you add in the report); no hard-wrapped Markdown; commit after each item with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"` and no AI attribution; stage files explicitly; do not push. Do not run coverage beside other heavy runs.

## Done when

Every item done, each code fix with a test that was red first. Build, `fixtures:check`, typecheck, lint and `pnpm test --coverage` in every touched package, `lint:deps`, `lint:ratchets`, `check:error-reference`, `check:upgrade-coverage`, the MongoDB integration files and every MongoDB journey pass.

## Report

Plain English, short sentences: each item and what you did, the shape of the operation description in `ops.json`, how S03 was solved, the tests that were red first, the checks, and the commits.
