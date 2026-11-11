# Dispatch 29: fixes from the PR 4 review

**Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/pollyanna-30-context-6ee51c/wip/wt-pr4` · **Branch:** `tml-3537-value-object-variant-statements` (main is merged in) · **Reviews:** `projects/migration-statements/slices/remaining-nouns/reviews/pr4/system-design-review.md` and `code-review.md` in the worktree. Read both first.

Work only inside the worktree. Fix every item below. Write a failing test first for each behaviour change.

## Correctness

1. **SQLite: a variant with its own table whose discriminator value changes.** The default plan and `--delete Bug` delete only the base table's rows. The SQLite runner turns foreign keys off, so the declared `ON DELETE CASCADE` never runs, the variant table keeps rows that point at deleted base rows, and `PRAGMA foreign_key_check` fails the apply.
   - First add a failing case to `variant-statements.sqlite.e2e.test.ts` and to the SQLite variant row planning integration test.
   - Fix it in the SQLite target: before the base rows are deleted, delete the variant table's rows whose base row holds the old value, as the declared cascade would. Keep it inside the SQLite target's own operations; no framework change and no target branch in shared code.
   - Check Postgres has the same case covered by a test, and that the cascade runs there.
   - Fix the SQLite V4 journey header, which says a cascade deletes the rows. On SQLite the table is dropped first.
2. **`[*]` follows RFC 9535.** In RFC 9535, `[*]` and `.*` select every child: the elements of a list and the member values of an object. Today `[*]` skips objects, and `.*` is refused. We follow RFC 9535 and do not change its meaning.
   - Make `[*]` and `.*` select list elements and object member values, on both targets, in every operation that takes a path.
   - The planner keeps writing `[*]` for lists; its output does not change.
   - Tests: a hand-written `$[*].lat` on an object of objects, on PGlite and SQLite, with SQL `NULL`, JSON `null` and empty object cases. Update the docs and error text that describe the path syntax.
3. **A `--backfill` value the field's type does not hold.** `fillStoredKey` must refuse a value that the field's data type does not accept, using the same `DataType.fromContract` check as the `db update` temporary value. It refuses when the operation is built, so `node migration.ts` fails before `ops.json` is written, with `CONTRACT.ARGUMENT_INVALID` naming the field and the value. Test on both targets.
4. **A required list of enum values or of value objects.** `temporaryValueOf` refuses it, but `[]` fills it. Fill it with `[]`, as its doc comment says.
5. **Refusal advice that leads back to the same refusal.** The refusals for a union, a dictionary, or a value object that can contain itself tell the user to plan again or leave the rename out, which gets the same refusal or another one. Make them say to write the change as a hand-written data migration, and how (the `migration.ts` the user edits). Update the error reference.

## Design

6. **One SQL family function plans the rewrites.** Both target planners repeat the same code for value object field renames and removals, field fills, enum values and variant rows: the same rewrite map, statement positions and subject maps. Move it into one family function that takes the target's call constructors. The SQL and call classes stay in each target. Planner output must not change: the existing planner tests are the check.
7. **One name: "field".** The fill side calls a value object field a "member" (`value-object-member-fills.ts`, `planValueObjectMemberFills`, `unnamedMemberFillOf`). "Member" already means an enum member. Rename these to "field", with their tests and fixtures.
8. **Print `convert variant "Bug"`.** `describeMigrationStatement` prints `convert model "Bug"` for a variant convert. Make it say `variant`, as the CLI messages do. This is display text in the CLI; change no framework type.
9. **State the assumption in `unnamedMemberFillOf`'s doc comment, in one sentence:** a policy that allows `data` operations means a `migration.ts` is written.
10. **Shared planner test fixture.** `value-object-planner-fixtures.ts` is copied in both target test folders. Share one copy if a test-only import path between them already exists; otherwise leave both and say so.
11. **Record in `projects/migration-statements/deferred.md`:** both families keep a model's empty `fields` in their own canonicalization hook, though the path is a framework type and the framework already keeps `relations` and `storage`. Moving it into the framework canonicalizer would change the framework, so it waits for Will.

## PR text

12. In `wip/pr4-description.md`, add `MigrationRunnerFailureMeta.rowsHoldingValue`, which became a list, to the list of framework changes, with one sentence on why it does not change the framework domain. Update anything items 1 to 8 change.

## Rules

- Commit after each item, so a crash loses little.
- In `packages/1-framework`, change only what item 8 names. Change no framework type. If you find you must, stop and report it.
- Never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all`. Run named files with `pnpm test <file>` inside `test/integration`, and journeys with `pnpm test:journeys <file>`. `pnpm test:packages` is allowed.
- Use `mise exec --` for node and pnpm. Never `npx`. Do not write to `/tmp` or any system temp directory. Save slow output under `wip/` in the worktree and read the file. Never use bare `git stash`.
- No comments where the code can say it. No bare `as` casts in production code. No `any`. No file extensions in imports. No backwards-compatibility exports. Don't branch on target.
- No invented nouns: use the names in this brief or in the code. Never hard-wrap Markdown prose.
- Commit with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`. No AI attribution lines (no Co-Authored-By, no "Generated with"). Stage files explicitly. Never amend, rebase or force-push.
- Do not push. Do not open a PR.

## Done when

- `pnpm build` and `fixtures:check` are clean; typecheck, lint and `test --coverage` pass in every touched package.
- `lint:deps`, `lint:ratchets`, `check:error-reference` and `check:upgrade-coverage` pass.
- These journeys pass: `enum-value-statements*`, `value-object-checks`, `plans-with-no-operations*`, `variant-statements*`, `required-field-advice*`, `value-object-backfill*`, `value-object-statements*`.

## Report

Plain English, short sentences: each item and what you did, the tests that were red first, the checks, anything you could not do and why, and the commits.
