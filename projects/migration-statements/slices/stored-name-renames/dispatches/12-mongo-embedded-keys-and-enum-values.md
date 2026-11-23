# Dispatch 12 (MongoDB 3): embedded model keys and enum stored values

**Slice plan:** `projects/migration-statements/slices/stored-name-renames/plan-pr2.md`, row 3 · **Spec:** `projects/migration-statements/slices/stored-name-renames/spec.md` (the embedded model and enum rows of "The rule" and "Refused in this slice", "Freed and reused", "Text and code that goes away or changes"; MongoDB column) · **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-494725` · **Branch:** `gandhi-65/tml-3840-mongo-stored-name-renames` · **Tier:** Opus, medium effort

Notes in `wip/mongo-stored-names/d3-progress.md`. The rules of dispatch 10 (`dispatches/10-mongo-collection-and-field-renames.md` § Rules) hold unchanged: run only the test files you add or change, one file per command (`mise exec -- pnpm test test/<file>` from the package); nothing under `packages/1-framework`; no AI attribution in commits; do not push.

The reference is the SQL half's enum step, `dispatches/03-enum-stored-values.md`, and its code in `packages/2-sql-family/9-family/src/core/migrations/enum-value-planning.ts` (`valueChanges`, `cycleRefusal`, `mergingRefusal`, `stillStoredRefusal`). Plan and refuse the same cases with the same texts in MongoDB words, except one difference the spec records: MongoDB has no transaction, so its overlap check (ADR 188) refuses chains of enum values that SQL plans in order. Keep that, and make its advice a route that works.

## Part 0: fixes from the step 2 review, before anything else

The review is `wip/mongo-stored-names/d2-review.md`, with probes in `wip/mongo-stored-names/probes/d2.test.ts`. Commit these fixes before starting the outcome below.

1. **A dropped collection asks about every model whose documents it loses.** Today `collectionDrops` (via `modelStoredIn`) asks about one model, chosen by declaration order, so `--delete Admin` can delete every `User` document without `User` being named. A drop of a collection asks about every origin model stored there whose documents the plan does not move elsewhere, kept and removed alike. A kept model's question carries the split or merge advice. The result does not depend on declaration order: tests with both orders. Check how SQL handles the same case (a shared table dropped while one model leaves) and match it where MongoDB allows; say what you found.
2. **A field rename counts every model whose documents the rename reaches.** In `mongo-rename-conflicts.ts` (`originFieldsStoring`), a key counts as taken by any field of any origin model whose documents the rename reaches: other root models of a collection with no discriminator, the model's variants, and its bases. Then `User.a` moving from `x` to `y` while `Admin.b` keeps `y` in the same collection is refused with the takeover route, as SQL refuses it. When a base field takes the key of a removed variant field, the route names that field.
3. **Test files at most 500 lines.** Split `mongo-planner.stored-name-refusals.test.ts` into a collection file and a field file. Split `mongo-planner.variants.test.ts` by functionality.
4. **Minor.** Remove the false comment on the test helper `refused()`. A chain whose middle link is a merge says the model is being merged. Add one test that follows a route through `db update` (`executeDbUpdate`, as `db-update-statements.test.ts` does).

## Inputs

- `projects/migration-statements/handover-notes/mongo-code-map.md` § 1 "Embedded model and value object fields" and "Enum stored values", § 3 rows for embedded keys and enum values (line numbers have drifted; find functions by name).
- `renameRefused` in `mongo-storage-renames.ts` and the refusals in `mongo-rename-conflicts.ts`, built in the last two dispatches. Follow the same shape.
- The step 1 report's note: `mongo-rewrite-refusals.ts` sets kind `statementRefused` for key renames and value replacements, which is wrong once these can happen with no statement.

## Outcome

On MongoDB, for `migration plan` and `db update`:

1. **Embedded model fields.** A field of an embedded model that keeps its name and changes its `@map` is paired by its name in the same embedded model. Its key is renamed with `renameStoredKey` in every place the type is stored (`storedPlacesOf`), exactly as a field rename statement on an embedded model plans it today, with no question. The places that refuse a statement (an unlisted place, a type that contains itself, a key that cannot be rewritten, a collection not `managed`) refuse the same change with no statement, in text that names the contract change. Value object fields take no `@map`; nothing changes for them.
2. **Enum stored values.** A member that keeps its name and changes its stored value plans `replaceStoredValue`, exactly as an enum value rename statement for that member plans it today. A value freed by a member and taken by a new member is planned (the statement-only `stillStoredRefusal` does not apply to a member that keeps its name).
3. **Refused** with kind `unsupportedOperation`, no `refusedStatement`, text that names the enum, the members and the stored values and never says "statement", and a two-plan route through a value no member stores (`prisma_swap`, or the next integer for a number), as SQL's `cycleRefusal` gives it:
   - a cycle or swap of stored values;
   - a chain, which the overlap check refuses on MongoDB;
   - a member taking the stored value of a member the destination removes, or of a member that keeps it (a merge).
   A cycle, chain or merge that involves a statement keeps today's statement refusal.
4. **Refusal kinds.** Every refusal of a key rename or value replacement that has no statement is `unsupportedOperation` with no `refusedStatement`, including those built in `mongo-rewrite-refusals.ts` and `mongo-stored-key-planning.ts`. Find each site with a search and list it in your notes.
5. **Removed.** No `KeepDataEdit`, `keepDataEdit`, `takenValueAdvice` or `twoMigrationsAdvice` for a member that keeps its name, because that change is never asked about now. Remove the MongoDB target code that only served it, with its tests. Do not change `packages/1-framework`. List in your report what in `packages/1-framework` (CLI package: `twoRuns` in `keep-data-edit-advice.ts`, `keepsDataByCommand` and `sharesValueWithKeptMember` in `plan-questions.ts`) is now reached by no target, and whether the runners' apply-time `keepDataEdit` (`mongo-runner.ts` `keepRemovedValueEdit`, and the PostgreSQL and SQLite runners through `rows-holding-value.ts`) still reaches it. Report only; do not delete.
6. **Everything a statement handles works the same** with no statement: an enum used inside an embedded model or value object, an array of the enum, a nullable field, numeric stored values, a variant discriminator typed by an enum (which stays a `--convert` question, as the spec says), the validator's `enum` list. Add a test for each that the statement path has.
7. **Storage hash.** Check by test whether an enum whose stored values only trade places changes the MongoDB storage hash (whether the validator orders its `enum` list). Report what you find; do not change it.
8. **Existing tests** that assert the old removal, keep-data edit or two-migrations advice for a member that keeps its name, or a removal for an embedded field whose `@map` changes, are rewritten to show the plan or the refusal.

## Not in this dispatch

`db update` against a mismatched database (next dispatch), CLI text in `packages/1-framework`, journeys, docs. If a journey outside the package would fail, list it from reading; do not run or rewrite it.

## Done when

- `mise exec -- pnpm build` is clean; typecheck and lint pass in the MongoDB target package.
- `mise exec -- pnpm lint:deps` and `mise exec -- pnpm lint:ratchets` pass.
- Tests exist and pass, each run by file, for every item above, each red before the change where it is a behaviour change; refusal tests assert the whole conflict; plan tests the whole operation list; each refusal route followed to the end in a test.
- `git diff --stat origin/main -- packages/1-framework` is empty.

## Report

Plain English, short: what is now true; tests red first; each refusal's text and route; the refusal-kind sites and their disposition; what in `packages/1-framework` is now unreached; the storage-hash finding; journeys that will fail and why; any difference from SQL with its reason; commits; checks with results.
