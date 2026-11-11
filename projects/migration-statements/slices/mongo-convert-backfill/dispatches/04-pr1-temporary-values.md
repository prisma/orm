# Dispatch 4: `fillField` fills a new required field with a temporary value

**Spec:** [`../spec.md`](../spec.md), decision 5 and its table, the "Required field added" row · **Plan:** [`../plan-pr1.md`](../plan-pr1.md) · **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/pollyanna-30-context-6ee51c/wip/wt-4b` · **Branch:** `tml-3538-mongo-value-object-statements` (dispatches 1 to 3 are committed there)

Work only inside the worktree.

After dispatch 1, adding a required field to a collection with documents fails at the validator change's document check, because the documents lack the field. SQL fills such a field with a temporary value (`''`, `0`, …) without asking (slice 3a). This dispatch does the same on MongoDB, with a new operation Will named `fillField`.

## Behaviour

1. **`fillField({ collection, field, value })`** sets `field` to `value` in every document where it is missing or `null`, in one `updateMany` that skips document validation. Its postcheck: no document has the field missing or `null`. It is `widening`. Give it the full set: factory, call class with `renderTypeScript`, serializer support, a preview line, and the `fieldRewriteOf` recognition dispatch 2 added for casts. Re-running `migration.ts` reproduces `ops.json`.
2. **The value is a typed expression**, because `ops.json` is plain JSON and a plain `0` is stored as an `int`. Use the spec's table: `{ $literal: '' }` for `mongo/string`, `0` for `mongo/int32`, `{ $toLong: 0 }`, `{ $toDouble: 0 }`, `{ $toDecimal: '0' }`, `false` for `mongo/bool`, `[]` for any list. Write it through an update pipeline so the expressions are evaluated. Take the value from the codec: put the table where each codec is described (the target's data types or codec descriptors), not in a planner switch. Codecs with no temporary value (date, ObjectId, binary, `Json`, `Bson`, vector, enum, value object, embedded model) get none.
3. **The planner writes `fillField`** for a field that is required in the destination and new on an existing collection, when no `--backfill` names it and its codec has a temporary value. A field with a default is filled from its default instead, if the contract can express a default on MongoDB; check, and if not, leave defaults out. Order: in the rewrite step with the fills, before the validator change (spec, "Order inside the rewrite step").
4. **No temporary value:** the planner writes nothing, and the document check fails the apply while documents lack the field (dispatch 1). An optional field made required gets no fill, as on SQL.
5. **A field under a unique index** gets no temporary value: refuse the plan naming the field and `--backfill`, as SQL refuses unique columns.
6. **Shared and time-series collections, and variants:** reuse dispatch 2's refusals and discriminator filter.
7. **Reporting:** each fill is reported in `temporaryValues`, as SQL reports its temporary defaults (`reportTemporaryValues` in the CLI's `statements/temporary-values.ts`), so `migration plan` and `db update` say which fields got one.
8. **The journey S3** in `delete-statements-migration.mongo.e2e.test.ts` now passes: remove its `it.fails` mark and the comment dispatch 1 added, and keep its assertions.

## Tests

Write a failing test first for each behaviour.
- Factory, call class and serializer: render, round-trip, `ops.json` from a `migration.ts` that calls `fillField`.
- Planner tests: a new required `String`, `Int`, `BigInt`, `Float`, `Decimal`, `Boolean` and list field each get the right value; a `DateTime` field gets none; a unique field is refused; a variant field carries its discriminator filter; `--backfill` on the field writes no fill.
- Integration tests against mongodb-memory-server: each numeric fill stores the right BSON type and the validator's document check then passes; documents holding `null` are filled; documents that already hold a value are left alone.
- CLI tests: `temporaryValues` lists the fill for both commands.

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
- The checks in the plan's "Checks for every dispatch" pass, with no journey marked as failing.

## Report

Plain English, short sentences: each behaviour and what you did, where the temporary value table lives, the `migration.ts` the planner writes for a new required `BigInt` field, the tests that were red first, the checks, anything you could not do and why, and the commits.
