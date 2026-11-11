# Dispatch 7: fixes from the whole-branch review of PR 1

**Reviews:** `../reviews/pr1/system-design-review.md` (S01 to S11) and `../reviews/pr1/code-review.md` (F01 to F08) · **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/pollyanna-30-context-6ee51c/wip/wt-4b` · **Branch:** `tml-3538-mongo-value-object-statements`

Read both reviews first. Fix everything below, each code fix with a test that fails without it. Leave alone: `migration plan` and planner warnings, the no-origin question wording, and the error code `DATA_TRANSFORM_CHECK_NOT_READ_ONLY` (S10; public, kept as is).

## Shared shape first (S01, S03, S04, S07, S09)

PR 2 will add five more rewrite kinds, so fix the duplication now:

1. **One description of a planned rewrite, one refusal of each kind over it** (S01, F01). The time-series refusal and the shared-collection refusal are each written three times (removal, cast, fill), and the `--convert` and `--backfill` scaffolds get neither. Make one refusal of each kind that every rewrite kind passes through, scaffolds included. Test a scaffold refused in a time-series collection and in a shared collection.
2. **One reading of validator shapes, per root model and per variant** (S03, F02). Move it into `packages/2-mongo-family/1-foundation/mongo-contract` (the review suggests `validator-shapes.ts`). The runner's `fieldsTouched`, `variantKey` and root matching by position, and the planner's `planValidatorTypeChanges` and `requiredInOrigin`, all use it. Without an origin contract, a cast must apply to one root model's documents only, filtered, with the shared-collection refusal where no discriminator tells them apart. Test two root models sharing a collection without an origin contract, in both orders of the validator's `anyOf`.
3. **Contract lookups out of the planner module** (S04). The runner must not import from the planner. Move `collectionOf` and the stored-name-to-field lookup (`fieldStoredAt`) into `mongo-contract`. Fix `collectionOf`'s fallback to the model's name: a model without a collection of its own resolves through its base or embedding, or the statement is refused naming the model.
4. **One way to find the same model or field in the other contract** (S07): `destinationModelOf`, `originModelOf`/`originFieldOf` and `renamedFieldOf` follow one set of rules, in one place.
5. **Type lookups from the stack** (S09), as SQL does, so a data type an extension adds is seen by type change and fill planning. One place, not two copies.

## Correctness

6. **F03.** `backfillTransform` and `convertTransform` refuse a stored name containing `.` or starting with `$`, as 4a refuses such fields, and refuse a collection whose control policy is not managed. `convertTransform` must not say "its type does not change" for these; give the real reason.
7. **F04.** For a MongoDB error other than a failed cast, `rewriteFailure` must not claim "a re-run rewrites the rest". Say what is true (documents already written stay written; a re-run meets the same error until the cause is fixed) and give a `fix` where one is known, such as the duplicate key's index.
8. **S02.** The runner works out what an operation is from the shape of its update. An operation of class `data` is never read as a planner cast or fill: a filled `--backfill` that hits error 241 is reported as the user's data transform failing, not as a type change. Add the test.
9. **S05.** On `collMod`, `checkDocuments` without a validator is refused when the operation is built, not ignored. Record where the option sits on each call in ADR 188.
10. **S06.** `castField` takes one object, `castField({ collection, field, from, to, list?, filter? })`, like `fillField`. ADR 188 says the class comes from `from` and `to`.

## Tests

11. **F05.** Apply each new rewrite kind (cast, `--delete` cast, filled `--convert`, filled `--backfill`, fill) to an empty collection, and a test that fixes the runner's order of reading the postcheck before the precheck for these.
12. **F06.** Every journey that writes a `migration.ts` re-runs it and compares the new `ops.json` with the old.

## Docs and names

13. **S11, F07.** The Migration System example uses the `$expr` filters the code writes. In the CLI README, move the MongoDB sentences so "Fill it, for example `using: …`" stays with SQL.
14. **S08.** ADR 188 describes `MongoDmlCheck` as a subset of `MongoMigrationCheck` and how the two check sources are told apart.
15. ADR 188 says in one sentence why `rawAggregate` and `rawUpdateMany` exist beside `mongoRaw(...)`: they address a collection by its stored name, need no execution context, and can skip document validation.
16. Rename `bson-casts.ts` after `$convert` so it is not confused with `DataType.casts`, and rename `structureChangeWarnings` to match the warning kind `documentsNotRewritten`.

Do not edit `deferred.md` for the Prisma 6 guide (F08); the orchestrator files a Linear ticket.

## Rules

As in the earlier briefs: nothing in `packages/1-framework` apart from prose; never the full integration suites; `mise exec --`; no `/tmp`; no bare `git stash`; no comments where code can say it; no bare `as`; no invented nouns; no hard-wrapped Markdown; commit after each item with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"` and no AI attribution; stage files explicitly; do not push. Do not run coverage beside other heavy runs.

## Done when

- Every item done, each code fix with a test that was red first.
- The checks in the plan's "Checks for every dispatch" pass, including `check:upgrade-coverage`, and every MongoDB journey passes.

## Report

Plain English, short sentences: each item and what you did, where the shared pieces now live, the tests that were red first, the checks, anything you could not do and why, and the commits.
