# Dispatch 2: a MongoDB type change is asked about and answered by a cast

**Spec:** [`../spec.md`](../spec.md), decisions 2 and 3, the first three rows of "What changes for users" · **Plan:** [`../plan-pr1.md`](../plan-pr1.md) · **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/pollyanna-30-context-6ee51c/wip/wt-4b` · **Branch:** `tml-3538-mongo-value-object-statements` (dispatch 1 is committed there)

Work only inside the worktree. Read the spec's decisions 2 and 3 first.

Today a MongoDB field type change plans only a validator change. After dispatch 1 that validator change fails while documents hold the old type. This dispatch finds type changes, asks about the ones that lose data, and plans the cast.

## Behaviour

1. **Finding a type change.**
   - With an origin contract: per model, per variant and per embedded model field, compare the codec BSON types of the origin and destination field (`bsonTypesOfCodec`, as 4a's `planFieldRemovals` reads the contracts). A list field compares its element types.
   - Without one: compare the two validators' properties: `null` removed from both sets, an empty set read as any value, list element types compared through `items`.
   - It is a type change when some old type is not allowed by the new field. A field gaining an enum, or a value object field changing type, is not a type change by these rules; leave both alone (dispatch 5 warns about them).
   - Only top-level fields of a collection's documents in this dispatch: a model's own fields and a variant's own fields. Fields inside value objects and embedded models are PR 2.
2. **New validator accepts every old value** (the new field is `Bson`, or `Json` from a type `Json` holds): nothing is planned beyond the validator change, nothing asked.
3. **A cast that keeps every value:** `int` to `long`, `double` or `decimal`; `long` to `decimal`. Plan one rewrite, classed `widening`, nothing asked: an `updateMany` with an update pipeline that sets the field to `$convert` of itself to the new BSON type, no `onError`, filtered on documents where the field exists, is not `null`, and its type is not one the new field allows. List fields convert each element with `$map`. Skip document validation, as 4a's rewrites do. Its postcheck: no document matches the filter.
4. **Any other type change** is a `typeChange` data loss on the field subject (`MigrationDataLoss.loss: 'typeChange'`), asked about like SQL. Without an origin contract the subject is the storage subject `<collection>.<field>`, as 4a names removed fields, and the question text uses the type change wording, not "would lose the data".
5. **`--delete User.age` on a type change** plans the same `$convert` rewrite as behaviour 3, classed `destructive`, reported as "accept lossy type change of field" as SQL reports it. A value MongoDB cannot cast fails the update; that failure gets a typed runner failure of its own whose message names the field and says to use `--convert` in `migration plan`. Where `$convert` has no conversion between the two types (for example `object` to `string`), the question offers `--convert` only and `--delete` is refused with the reason.
6. **`--convert User.age`** is accepted by the planner from this dispatch on only in the sense that it stops being refused as "MongoDB does not apply convert statements in this release" for a top-level field type change. Its scaffold is dispatch 3: in this dispatch the planner may refuse `--convert` with a plain reason that dispatch 3 replaces. Keep `--backfill` refused until dispatch 3.
7. **Shared and time-series collections.** A rewrite in a time-series collection is refused, as 4a refuses removals there. A root model's rewrite in a collection another root model shares, where no discriminator tells their documents apart, is refused. A variant field's rewrite filters on its discriminator value. Reuse 4a's refusals (`sharedCollectionRemovalRefusals`, `timeSeriesRemovalRefusals` in `mongo-statement-planning.ts`), generalised if needed.
8. **Order.** The rewrites run in 4a's rewrite step, after field renames and before removals (spec, "Order inside the rewrite step"), and before the validator change.

## Tests

Write a failing test first for each behaviour.
- Planner tests: each kind of change in behaviours 2 to 5, with and without an origin contract; a list field; a variant field with its discriminator filter; a shared collection and a time-series refusal.
- Integration tests against mongodb-memory-server: `Int` to `BigInt` on documents converts every value and the validator change's document check then passes; `String` to `Int` with `--delete` converts `"42"` and fails on `"abc"` with the typed failure; a re-run after the fix skips the finished rewrite.
- CLI tests: the question offers `--convert` and `--delete` for a lossy change, and `--convert` only where no cast exists.

## Rules

- Commit after each behaviour, so a crash loses little.
- Change nothing in `packages/1-framework`. If you find you must, stop and report it.
- Never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all`. Run named files with `pnpm test <file>` inside `test/integration`, and journeys with `pnpm test:journeys <file>`. `pnpm test:packages` is allowed.
- Use `mise exec --` for node and pnpm. Never `npx`. Do not write to `/tmp` or any system temp directory. Save slow output under `wip/` in the worktree and read the file. Never use bare `git stash`.
- No comments where the code can say it. No bare `as` casts in production code. No `any`. No file extensions in imports. No backwards-compatibility exports. Don't branch on target.
- No invented nouns: use the names in this brief, the spec or the code. Never hard-wrap Markdown prose.
- Commit with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`. No AI attribution lines (no Co-Authored-By, no "Generated with"). Stage files explicitly.
- Do not push. Do not open a PR.

## Done when

- Every behaviour above has a test that was red first and is green now.
- The checks in the plan's "Checks for every dispatch" pass, apart from the journey dispatch 1 marked as failing.
- Docs: `docs/reference/error-reference.md` has the new failure.

## Report

Plain English, short sentences: each behaviour and what you did, the `migration.ts` the planner writes for `Int` to `BigInt` and for `--delete` on `String` to `Int`, the failure text for a value that cannot be cast, the tests that were red first, the checks, anything you could not do and why, and the commits.

## Carry-over from the dispatch 1 review

Fix these first, each with a test that fails without the fix. The review is `../reviews/code-review.md`, dispatch 1.

1. Add a case to `runner-validator-document-check.test.ts` where an index operation runs before a failing validator change. Assert the full `why` and `databaseUnchanged: false`.
2. `isInspectionCheckSource` (`migration-operation-types.ts`) tests `instanceof` on two classes. A third inspection command would reach `documentsMatch` and crash. Decide by the command's kind or by the query plan's shape.
3. `documentsMatch` (`mongo-runner.ts`) now runs validator checks too, but a check that writes still fails with data-transform wording. Word it for any migration check.
4. If documents are fixed between the check and the count, the failure says "0 documents" and "_id undefined". When the count is 0, fall back to the generic precheck failure.
5. `mongoshValue` writes only ObjectIds as `mongosh` does. Handle `Date` and `UUID` too, and say in the error reference what other `_id` types look like.
6. Delete the doc comments on `validatorSetBy` and `documentsFitValidator`; they only repeat the names.
