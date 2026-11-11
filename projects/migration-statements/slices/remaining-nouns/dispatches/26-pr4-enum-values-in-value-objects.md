# Dispatch 26: enum values inside value objects, and two fixes from dispatch 25

**Plan:** [`../plan-pr4.md`](../plan-pr4.md) · **Grounding:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/pollyanna-30-context-6ee51c/wip/pr4-grounding.md`, section 5 and decisions C5, C6 · **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/pollyanna-30-context-6ee51c/wip/wt-pr4` · **Branch:** `tml-3537-value-object-variant-statements` (dispatches 21–25 are committed there)

Work only inside the worktree.

## Part 1: enum values inside value objects

PR 2's enum value planning (`packages/2-sql-family/9-family/src/core/migrations/enum-value-planning.ts`) rewrites a changed enum value in every column a model field types with that enum. It never looks inside value objects: `columnsTypedBy` walks only model fields. So a value object member typed by an enum keeps the old value, and on Postgres the new shape check refuses those rows at apply.

1. **Find the members.** Extend the enum value planning to reach value object members whose value set is the enum's.
   - A value object member refers to the enum's storage value set (`ContractValueObjectField.valueSet`), keyed by the same namespace and name as the domain enum.
   - Use dispatch 24's function that finds every place a value object is stored, so each member gives a column and a path such as `'$.status'` or `'$.tags[*]'`.
   - The comparison of origin and destination enums, with its merge, cycle and swap refusals, stays as it is. Only the places to rewrite grow a path.
2. **Rewrite.** For each change, plan `replaceStoredValue` or `removeStoredValue` with dispatch 23's `path` option, comparing the value as a JSON value.
   - A removal from a list member removes the element.
   - A removal from an optional member sets JSON `null` (`nullable: true`).
   - A removal from a required member fails at apply while rows hold the value. It fails with `MIGRATION.PRECHECK_FAILED`, the row count, the path and the edit that keeps the data, as dispatch 23 built.
3. **Questions.** An enum value removal is still one question about the enum value, however many columns and paths hold it. The question lists every operation's label, including the JSON ones.
4. **Order.** As for the other rewrites: on Postgres after the old check's drop and before the new one's add; on SQLite after the diff. When the same plan renames a value object field and changes an enum value inside it, the field rename runs first and the value rewrite uses the destination path.

## Part 2: two fixes found in dispatch 25

5. **A removed variant's question lists every operation.** In `packages/1-framework/3-tooling/cli/src/control-api/statements/plan-questions.ts`, only enum value and value object field questions list the label of every operation with the same subject. Make every model question do so too, so a removed variant's question names both the column or table drop and the row deletion. This is CLI code, not a framework type, and it is allowed. Change nothing else in `packages/1-framework`.
6. **A variant with no fields of its own cannot be emitted from PSL.** `model Epic { @@base(Task, "epic") }` fails emit with `CONTRACT.VALIDATION_FAILED`: "models.Epic.storage.fields must be an object". Find where the storage fields of a variant without fields are left out. Fix it in the component that owns it, so the variant gets an empty `fields` object. Write the failing emit test first. Then add the "removed variant with no columns of its own" case to the SQLite variant journey `test/integration/test/cli-journeys/variant-statements.sqlite.e2e.test.ts`.

## Tests

Write a failing test first for every behaviour.
- **Planner tests on both targets** for part 1: a scalar member, a list member, an optional and a required member, a nested value object, and a value object field rename in the same plan.
- **Integration tests on PGlite and SQLite** that apply each plan and read the JSON back. On Postgres, check that the new shape check passes.
- **CLI tests** for the questions.

## Docs

Update the enum values paragraph of the Migration System doc's statements section to say that values inside value objects are rewritten too. Update the error reference for any new message.

## Rules

- Commit after each item, so a crash loses little.
- Never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all`. Run named files with `pnpm test <file>` inside `test/integration`, and journeys with `pnpm test:journeys <file>`. `pnpm test:packages` is allowed.
- Use `mise exec --` for node and pnpm. Never `npx`. Do not write to `/tmp` or any system temp directory. Save slow output under `wip/` in the worktree and read the file. Never use bare `git stash`.
- No comments where the code can say it. No bare `as` casts in production code. No `any`. No file extensions in imports. No backwards-compatibility exports. Don't branch on target.
- No invented nouns: use the names in this brief or in the code. Never hard-wrap Markdown prose.
- Commit with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`. No AI attribution lines (no Co-Authored-By, no "Generated with"). Stage files explicitly.
- Do not push. Do not open a PR.

## Done when

- `pnpm build` and `fixtures:check` are clean; typecheck, lint and `test --coverage` pass in every touched package.
- `lint:deps`, `lint:ratchets` and `check:error-reference` pass.
- These journeys pass: `enum-value-statements*`, `value-object-checks`, `plans-with-no-operations*`, `variant-statements*`.

## Report

Plain English, short sentences: each item and what you did, the `migration.ts` the planner writes for an enum value renamed inside a list member, where the empty-variant defect was and how you fixed it, the tests that were red first, the checks, anything you could not do and why, and the commits.
