# Dispatch 9: fixes from manual QA of PR 1

**QA report:** `projects/migration-statements/manual-qa-reports/2026-11-06-qa-4b-pr1.md` (problems 1 to 18) · **Review:** `../reviews/code-review.md`, dispatch 8 notes · **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/pollyanna-30-context-6ee51c/wip/wt-4b` · **Branch:** `tml-3538-mongo-value-object-statements`

Read the QA report first. Fix the items below, each code fix with a test that fails without it. Text that the CLI writes (in `packages/1-framework/3-tooling/cli`) is not yours to change in this dispatch; those items wait for Will and are listed at the end so you do not touch them.

## Data loss

1. **`--delete` casts only where `$convert` keeps the meaning (QA 1).** `$convert` turns every non-empty string into `true`, so `--delete` on `String` to `Boolean` turns `"false"` and `"no"` into `true`. Replace "any pair `$convert` accepts" with an explicit list, in `bson-convert.ts`, of the pairs whose `$convert` result is what a user means by casting: numbers between numeric types, numbers and booleans to strings, numeric strings to numbers, ObjectId to string, and the like. Go through every pair `$convert` accepts and decide each one; write the decision into the list. A pair not on the list has no cast: the question offers `--convert` only, as for pairs with no conversion. Test `String` to `Boolean` and every pair you leave off.
2. **Check the documents before the first rewrite, not only after the last (QA 2).** A failed apply must not leave documents that the current validator rejects because of a problem the plan could have seen first. Add an early document check, before the first rewrite on a collection, against the new validator relaxed for every field this plan rewrites on that collection (fills, casts, conversions, backfills, renames, removals): such a field is neither required nor type-checked, and a renamed field's old name is allowed. Documents that fail the relaxed check fail for reasons no operation in the plan fixes, so stop then, before any rewrite runs. The check after the rewrites stays, and still catches a rewrite that did not make the documents fit. Put the early check on the first rewrite of the collection, or as its own planned check, whichever fits the operation model; say which. Test QA 2's case: a fill for one new required field and a second new required field with no temporary value; the apply stops before the fill, and the documents are as they were.
3. **Say what ran (QA 2).** When the check after the rewrites fails, the `why` lists the operations of this apply that already ran on the collection, so the user knows what changed.

## Wrong advice

4. **Fixing documents by hand needs to skip validation (QA 3).** Every failure that says "change the documents so they fit" says that the old validator rejects such an update unless it skips validation, and shows how: a `dataTransform` in `migration.ts`, or in `mongosh` an update command with `bypassDocumentValidation: true`. The Migration System doc and the skill reference say it too.
5. **No `migration.ts` advice under `db update` from the runner (QA 4).** The runner does not know the command, so its `why` names both routes: under `db migrate`, set `checkDocuments: false` in that `migration.ts`; under `db update`, fix the documents first, since it writes no file.
6. **Name the real reason a document fails (QA 6).** For the one document the failure names, find why it does not fit, with small aggregates on that `_id`: required fields missing, fields whose type the new validator rejects, and fields the validator does not declare (closed validator). Name those. Keep "this change requires or retypes …" as a separate sentence.
7. **No unique index refusal for fills (QA 7).** A required field under a unique index gets no temporary value, and is left to the document check, as a `DateTime` is. Remove `fieldFillRefused` for unique indexes.
8. **Mention `--backfill` (QA 8).** When the change makes a field required, the failure says that under `migration plan`, `--backfill <Model.field>` writes a slot to fill the documents.
9. **A failed data transform check gets the document check's detail (QA 10).** When a data transform's postcheck still finds documents, the failure gives the count, one `_id` and the query, like the document check.
10. **Model rename onto an embedded model (dispatch 8 review note).** Refuse a model rename statement whose old or new model is embedded, like the field statements.

## Unclear text from the target

11. A list field is described by its element type in the type change text; say it is a list (QA 13).
12. A variant's validator line in the plan output has no `(changed: …)` list; add it (QA 17).
13. The placeholder slot of a scaffold, the docs and ADR 188 say the update may be an update document or a pipeline (QA 18).
14. Fix the broken line wrap in the doc comment in `mongo-documents-not-rewritten.ts` (dispatch 8 review note).
15. The spec, the QA script and the docs say `BigInt` where MongoDB PSL says `Int64`. Use `Int64` everywhere for MongoDB.

## Not yours (CLI text, waiting for Will)

Do not change: `migration plan` showing planner warnings, the warning's `why` not printed, the warning printed after the failure under `db update`; "Inspect the reported conflict, reconcile schema drift"; "write one there" after a cast failure; `--to <contract>` in `db migrate` advice; "Existing rows got …"; "would change the type … and can change or lose its values" for `--delete`; the no-origin question wording.

## Rules

As in the earlier briefs. Commit after each item with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"` and no AI attribution; stage files explicitly; do not push. Do not run coverage beside other heavy runs.

## Done when

Every item done, each code fix with a test that was red first; the checks in the plan's "Checks for every dispatch" pass; every MongoDB journey passes.

## Report

Plain English, short sentences: each item and what you did, the cast list with the pairs you left off and why, where the early check sits, example failure texts after the change, the tests that were red first, the checks, and the commits.
