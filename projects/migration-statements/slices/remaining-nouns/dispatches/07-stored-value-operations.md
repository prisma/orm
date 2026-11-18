# Dispatch 7 — operations that rewrite stored values

**Slice:** [`../spec.md`](../spec.md) § "What each statement does", Enum values · **Plan:** [`../plan.md`](../plan.md) § PR 2 · **Branch:** `tml-3537-enum-values`

## Outcome

A hand-written Postgres or SQLite `migration.ts` can rewrite the values stored in a column: change one stored value to another, and remove a stored value (set it to NULL in a scalar column, take it out of a list column). Each is a planner call that renders to `migration.ts` and to `ops.json`, and re-running the file reproduces `ops.json`. The planner does not plan them yet; dispatch 8 does.

## What the operations do

| Operation | Postgres | SQLite | Class |
| --- | --- | --- | --- |
| Change a stored value in a scalar column | `UPDATE t SET c = new WHERE c = old` | same | `widening` |
| Change a stored value in a list column | `UPDATE t SET c = array_replace(c, old, new) WHERE old = ANY(c)` | the JSON text the SQLite list codec stores, rewritten with `json_` functions; find how SQLite stores a list column first | `widening` |
| Remove a stored value from a scalar column | `UPDATE t SET c = NULL WHERE c = old` | same | `destructive` |
| Remove a stored value from a list column | `UPDATE t SET c = array_remove(c, old) WHERE old = ANY(c)` | as above | `destructive` |

- The values are stored values in the form the column's codec writes them (a member's `value`, not its name). Render them as parameters or through the codec's literal rendering the planner already uses for defaults and checks; never by string concatenation.
- Checks follow ADR 038. Before: nothing to require. After: no row holds the old value (scalar), or no list contains it. That postcheck holds before the operation only when the operation's full effect is in place, so a re-run skips it.
- The classes follow the project's rule that rewrites are classed by their effect (MongoDB's `renameField` is `widening`, `unsetField` is `destructive`), so `db update` can run them.
- Whether these are two operations with a mode, or four, is your call. Follow the shape of the existing operations on each target and say why in the report.

## Do

1. Read the existing operations on each target first: the call classes in `op-factory-call.ts`, the op builders, the facade (`postgres-migration.ts`, `sqlite-migration.ts`), `render-typescript.ts`, `render-ops.ts`, and `operation-subjects.ts`. Package paths moved on main recently (`packages/3-targets/postgres/1-target`, `packages/3-targets/sqlite/1-target`); use the current tree.
2. **Names:** name each facade method after what it does to the stored values, in the style of the existing facade methods. Do not invent a new noun for the concept; if no existing word fits, describe it in the report with two or three candidate names and pick the plainest. Report every new exported name.
3. **Subjects:** a destructive call needs a subjects entry (`operation-subjects.ts` on each target), so its data-loss question can name it. For now name it by table and column; dispatch 8 gives it the enum value subject.
4. **Tests first, red before each change:** rendering to TypeScript and to `ops.json`; the facade method produces the same operation as the call; on PGlite and on SQLite each operation rewrites the rows that hold the value and leaves the rest, its postcheck holds afterwards, and a second run through the runner executes 0 operations; a value with a quote in it, a numeric enum value (an `Int` enum), and a list column; the `migration.ts` round trip in the adapter round-trip tests.
5. **Docs:** Migration System, beside the other facade methods; the error reference if a code is added.

## Do not

- Do not plan these from a statement or from the diff; that is dispatch 8.
- Do not touch value object JSON; that is PR 4.

## Rules

- Never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all`. Only named files inside `test/integration` with `pnpm test <file>`.
- The machine is heavily loaded; run tests by file where you can, and treat a 500 ms timeout in a file you did not touch as load, but re-run it alone to confirm.
- Use the shell's Node and `pnpm`. Never `npx`.
- No comments where the code can say it; no bare `as` casts in production code; no file extensions in imports; no backwards-compatibility exports.
- Commit with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`. No AI attribution lines. Stage files explicitly.
- Do not push. Do not open a PR.
- Save slow command output under `wip/` and read the file.

## Done when

- Typecheck; lint and `test --coverage` in the Postgres and SQLite target and adapter packages; `lint:deps`; `lint:ratchets`; `fixtures:check`; `check:error-reference`.

## Report

Plain English, short sentences: the operations, their names and arguments and why, how SQLite stores a list column and how its rewrite works, the test that was red first for each change, the gates with results, anything the brief did not cover, and the commits.
