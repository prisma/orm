# Dispatch 3: `--convert` and `--backfill` write a data transform to fill in

**Spec:** [`../spec.md`](../spec.md), decision 4, the "In one example" section, and the `--convert` and `--backfill` rows · **Plan:** [`../plan-pr1.md`](../plan-pr1.md) · **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/pollyanna-30-context-6ee51c/wip/wt-4b` · **Branch:** `tml-3538-mongo-value-object-statements` (dispatches 1 and 2 are committed there)

Work only inside the worktree.

After dispatch 2, a lossy type change is asked about with `--convert` and `--delete`, but MongoDB refuses `--convert` and `--backfill`. This dispatch makes both write a scaffold the user fills in, as SQL's 3a does. Look at how Postgres renders its `DataTransformCall` and how its `toOp()` returns an unfilled placeholder operation (`packages/3-targets/postgres/1-target/src/core/migrations/op-factory-call.ts`, near line 2910).

## Behaviour

1. **A data transform call class for MongoDB.** The planner writes `dataTransform(name, { check, run })` (`migration-factories.ts` 69-114):
   - `check.source` is a `rawAggregate` with `$match` on the planner's filter and `$limit: 1`. The runner accepts only aggregate checks.
   - `run` is a raw `updateMany` on the collection with the planner's filter, `bypassDocumentValidation: true`, and the update as `placeholder('<Model.field>:update')`. The old validator is strict and would reject the user's update without the bypass.
   - Find or add the factories `migration.ts` needs to write these (an aggregate check source and a raw `updateMany` that takes the bypass), exported from the target's `migration` entry. Use existing names where they exist.
   - Its `toOp()` returns an unfilled placeholder operation when the slot is not filled, as SQL's does, so the rest of the plan still lists. Today `dataTransform` calls `run()` at once, and an unfilled placeholder throws for the whole list.
   - It is classed `data`. Re-running the filled `migration.ts` reproduces `ops.json`.
2. **`--convert User.age`** on a lossy type change: the data transform, with the filter "the field exists, is not `null`, and its type is not one the new field allows" (dispatch 2's filter). It replaces the `--delete` cast for that field. Remove dispatch 2's temporary refusal.
3. **`--backfill User.plan`**: allowed where the field is required in the destination and either new on an existing collection or optional before (as 3a). The filter is "the field is missing or `null`". A field with a default gets no backfill, as on SQL (`backfillOfDefaultedField`). Remove MongoDB's refusal of backfill statements for top-level fields. Value object fields stay refused until PR 2.
4. **Order:** the data transforms run in the rewrite step after the casts (spec, "Order inside the rewrite step"), before the validator change, whose document check then proves the user's update.
5. **`db update`** refuses both with `MIGRATION.STATEMENT_NEEDS_MIGRATION_FILE`. The CLI already does this for every family; add a MongoDB test for each.
6. **A hand-written `run` must skip validation too.** Say so in the Migration System doc's MongoDB part, where data transforms are described. If the database user lacks the privilege to bypass validation, 4a's missing-privilege failure should cover it; check that it does for a data transform's run.

## Tests

Write a failing test first for each behaviour.
- Call class: rendering with the slot empty and filled; `toOp()` with the slot empty returns the unfilled placeholder result; the other operations of the plan still list.
- Planner tests: `--convert` and `--backfill` on new and on optional-made-required fields; a defaulted field refused; a variant field's filter carries its discriminator.
- Integration tests against mongodb-memory-server: fill the placeholder with a real update, re-run the file, apply; the documents are converted or filled and the validator change's document check passes. A re-run after apply skips the transform through its check.
- CLI tests: `migration plan --convert` and `--backfill` write `migration.ts` with the slot and report the pending placeholder; `db update` refuses both.

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

## Report

Plain English, short sentences: each behaviour and what you did, the `migration.ts` the planner writes for `--convert User.age` and `--backfill User.plan`, the factory names you used or added and why, the tests that were red first, the checks, anything you could not do and why, and the commits.

## Carry-over from the dispatch 2 review

Fix these first, each with a test that fails without the fix. The review is `../reviews/code-review.md`, dispatch 2. Its finding 2 (the wording without an origin contract) waits for Will; leave it.

1. **Major.** When a value cannot be cast, `castRefusal` writes its own advice into `why`, and the CLI adds its own from `failedTypeChange`; for `db migrate` the two contradict. Make the `why` only the field, MongoDB's reason, and that documents already cast stay cast, as Postgres does. Update the error reference. Add a journey step: `--delete` on `String` to `Int` with an `"abc"` document, `db migrate` fails, and the advice appears once.
2. The validator tests in `mongo-planner.test.ts` moved to `planCallsSuccess` and so hide that `plan()` now refuses `Bson` to `Json` without an origin contract. Give that refusal its own test.
3. Add a test in `migration-e2e.test.ts` that runs a `migration.ts` calling `castField`, with `list` and `filter`, and compares the `ops.json` it writes.
4. Rewrite errors other than error 241 (for example a duplicate key after a partial write) are rethrown without `wrote()`. Call it for those too.
5. `bypassValidationRefusal` and its error reference entry say "Renaming or removing a field". Word them for any rewrite.
6. `castFieldOf` and the family's `rewrittenField` parse the same pipeline. Get the field from `fieldRewriteOf`.
7. Without an origin contract the refusal says "Store the snapshot of the contract the database is at", which no command does. Use the SQL advice: start from `--from <hash>`.

Also from the review: add the journey step behaviour 2 needs, the T2 refusal, then a re-run with `--convert User.age` that writes the scaffold.
