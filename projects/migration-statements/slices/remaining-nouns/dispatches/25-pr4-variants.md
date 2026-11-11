# Dispatch 25: the planner writes variant converts and deletes

**Plan:** [`../plan-pr4.md`](../plan-pr4.md) · **Grounding:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/pollyanna-30-context-6ee51c/wip/pr4-grounding.md`, section 6 and decisions C4, C9, C10 · **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/pollyanna-30-context-6ee51c/wip/wt-pr4` · **Branch:** `tml-3537-value-object-variant-statements` (dispatches 21–24 are committed there)

Work only inside the worktree.

A variant is stored in its base's table and selected by the discriminator column. For example, `Bug` is the rows of `tasks` whose `type` is `'bug'`. A variant with `@@map` also has its own table, whose foreign key to the base has `ON DELETE CASCADE`. The fixture is `test/integration/test/sql-orm-client/fixtures/polymorphism/`.

Today a change to a variant's discriminator value, or a removed variant, plans nothing for the base rows, so on Postgres the new discriminator check refuses them at apply. Dispatch 21 lets the CLI resolve `--convert Bug` and ask about a changed variant with `--convert` first. Dispatch 23 added `deleteRows`. This dispatch makes the planner write the operations. Follow the way dispatch 24 wired value object rewrites beside the diff.

## Behaviour

1. **`--convert Bug`.** When `Bug` is a variant in both contracts and its discriminator value changed, plan `replaceStoredValue` on the base table's discriminator column, from the old value to the new one, with the column's codec. Fill the statement's operation positions through dispatch 22's outcome. `db update` runs it.
2. **`--rename Bug:Defect`.** When the value also changed, the rename rewrites the value in the same way, with no `--convert`. A rename whose value did not change plans no row change.
3. **A changed value with no statement.** Plan `deleteRows` for the old value on the base table. It is destructive, so it is asked about as the model `Bug`; the question offers `--convert Bug` first and `--delete Bug` second (dispatch 21). `--delete Bug` accepts it.
4. **A removed variant** (in the origin, not in the destination, and named by no rename): plan `deleteRows` for its value. It is one question about the model `Bug`.
   - **Own table:** the plan drops the table, as today.
   - **Shared table:** the columns only it used are dropped, as today, but they are asked about as the model `Bug`, not one question per field. Map them to the model subject in the family `subjectOf` when the only model that stores a column is a variant the destination no longer has and no rename names. A removed namespace's tables already become per-model questions; follow that.
   - **No columns of its own:** today nothing is asked. Now the `deleteRows` call is asked.
5. **Order.**
   - On Postgres the row changes go in the `alter` bucket, after the old discriminator check is dropped and before the new one is added. The drop of a variant's own table runs before them, which is fine because the plan drops that table anyway.
   - On SQLite, append the row changes after the diff.
6. **Referenced rows.**
   - On Postgres, deleting base rows follows each referencing foreign key's `ON DELETE`.
   - On SQLite the migration runner turns foreign keys off, so a deleted row that another table references makes `PRAGMA foreign_key_check` fail the apply. Do not emulate cascades. Say this in the question text and in the docs, and test the SQLite failure message.
7. **Variant field statements on a variant with its own table** already act on that table. Add a planner test that shows it.

## Tests

Write a failing test first for every behaviour.
- **Planner tests on both targets:** convert, rename with a new value, rename without one, changed value with no statement, removed variant with its own table, with shared columns, and with no columns of its own.
- **Integration tests on PGlite and SQLite** that apply each plan to rows and read them back. On Postgres, check that the new discriminator check passes.
- **CLI tests:** the questions and their answers, including `db update --convert Bug`.

## Docs

Update the Migration System doc's statements section and its rename limits, and `docs/reference/error-reference.md` for any new message.

## Rules

- Commit after each behaviour, so a crash loses little.
- Change nothing in `packages/1-framework`. If you find you must, stop and report it.
- Never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all`. Run named files with `pnpm test <file>` inside `test/integration`, and journeys with `pnpm test:journeys <file>`. `pnpm test:packages` is allowed.
- Use `mise exec --` for node and pnpm. Never `npx`. Do not write to `/tmp` or any system temp directory. Save slow output under `wip/` in the worktree and read the file. Never use bare `git stash`.
- No comments where the code can say it. No bare `as` casts in production code. No `any`. No file extensions in imports. No backwards-compatibility exports. Don't branch on target.
- No invented nouns: use the names in this brief or in the code. Never hard-wrap Markdown prose.
- Commit with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`. No AI attribution lines (no Co-Authored-By, no "Generated with"). Stage files explicitly.
- Do not push. Do not open a PR.

## Done when

- `pnpm build` and `fixtures:check` are clean; typecheck, lint and `test --coverage` pass in every touched package.
- `lint:deps`, `lint:ratchets` and `check:error-reference` pass.
- These journeys pass: `enum-value-statements*`, `value-object-checks`, `plans-with-no-operations*`.

## Report

Plain English, short sentences: each behaviour and what you did, the `migration.ts` the planner writes for a changed variant value and for a removed variant, the tests that were red first, the checks, anything you could not do and why, and the commits.
