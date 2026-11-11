# Dispatch 24: the planner writes value object field renames and removals

**Plan:** [`../plan-pr4.md`](../plan-pr4.md) · **Grounding:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/pollyanna-30-context-6ee51c/wip/pr4-grounding.md`, sections 3, 7 and 8 (C1–C3, C11) · **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/pollyanna-30-context-6ee51c/wip/wt-pr4` · **Branch:** `tml-3537-value-object-variant-statements` (dispatches 21–23 are committed there)

Work only inside the worktree. Dispatch 21 lets the CLI resolve `--rename GeoPoint.lat:GeoPoint.latitude` and ask about a removed value object field. Dispatch 22 added the "planned with the diff" outcome. Dispatch 23 added `renameStoredKey` and `removeStoredKey`, which take an RFC 9535 path (`'$[*].lat'`). This dispatch makes the planner write those operations. PR 2's enum value planning (`enum-value-planning.ts`, and `storedValueCallsStrategy` in each target's planner) is the model to follow.

## Items

1. **Find every place a value object is stored.** Add a family function, beside the enum value planning, that walks:
   - every model field whose type refers to a value object;
   - through nested value object fields and lists;
   - to the columns of managed tables in the working schema.

   It returns, for each column, the RFC 9535 path to each object of that value object, for example `'$'`, `'$[*]'`, `'$.point'` or `'$.history[*].point'`.
   - Read value objects from the storage plane, as PR 3's readers do.
   - Compute paths from the destination contract and the working schema, so a column renamed in the same plan is written under its new name and a column added in the plan is skipped.
   - Check how a list of value objects is stored. If it is a database array of `jsonb` rather than one JSON array, report it and stop: dispatch 23's operations do not take list columns.
2. **Compare members.** For each value object in both contracts, compare origin and destination members.
   - A rename statement names a member as renamed. That plans `renameStoredKey` at every path, with `from` as the path's last step.
   - A member in the origin, not in the destination, and named by no rename plans `removeStoredKey`. That is destructive, so it is asked about with the `valueObjectField` subject from dispatch 21.
   - A new member plans nothing here; dispatch 27 handles required new members.
3. **Order.** When the same plan renames an outer member and an inner one (`Address.point` and `GeoPoint.lat`), the outer rename runs first, because inner paths are written with destination names. Sort by path depth.
4. **Refusals.**
   - Refuse, with a `SqlPlannerConflict`, a path that passes through a value object that can reach itself. For a statement, use `statementRefused` with the statement; for a removal with no statement, a plain conflict. Reuse PR 3's cycle detection (`reachesAny` in `packages/2-sql-family/1-core/contract/src/check-expressions.ts`): export it instead of copying it.
   - Refuse a column that holds a union or a dictionary of value objects, naming the column.
5. **Wire it into both targets.** Plan the calls beside the diff, as `storedValueCallsStrategy` does, so on Postgres they land in the `alter` bucket: after the old shape check is dropped and before the new one is added. SQLite appends them after the diff. Fill the operation positions of the rename statement through dispatch 22's outcome.
6. **Subjects and questions.** Map each `removeStoredKey` call to its `valueObjectField` subject in each target's call subjects. The CLI asks one question per value object field, listing the label of every operation, with the one new member of the value object offered as the rename.
7. **Out of scope.** Record these in `projects/migration-statements/deferred.md`:
   - a value object rename (`--rename Address:Location`) stays refused;
   - a member type change inside a value object is not a statement in PR 4; on Postgres the new check fails at apply.

## Tests

Write a failing test first for every behaviour.
- **Planner tests** on both targets: one column, a list, nested value objects, outer and inner renames in one plan, a column renamed in the same plan, a removal, the cycle refusal and the union refusal.
- **Integration tests** on PGlite and SQLite, applying a plan to rows: they check the JSON after the apply, and on Postgres that the new shape check passes.
- **CLI tests:** the question about a removed member, and `--delete GeoPoint.lng` answering it.

## Rules

- Commit after each item, so a crash loses little.
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

Plain English, short sentences: each item and what you did, how a list of value objects is stored, the `migration.ts` the planner writes for one nested rename, the tests that were red first, the checks, anything you could not do and why, and the commits.
