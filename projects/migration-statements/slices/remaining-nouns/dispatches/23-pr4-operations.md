# Dispatch 23: the JSON and row operations on Postgres and SQLite

**Plan:** [`../plan-pr4.md`](../plan-pr4.md) · **Grounding:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/pollyanna-30-context-6ee51c/wip/pr4-grounding.md`, section 3 (the SQL there was run on PGlite and SQLite) · **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/pollyanna-30-context-6ee51c/wip/wt-pr4` · **Branch:** `tml-3537-value-object-variant-statements` (dispatches 21 and 22 are committed there)

Work only inside the worktree. This dispatch adds operations a user can write by hand in `migration.ts`. The planner does not write them yet. Follow how PR 2 added `replaceStoredValue` and `removeStoredValue` on both targets: the call class, the op builder with its checks, `renderTypeScript`, the facade method on the migration class, subjects, and the `issue-planner` bucket.

## The path

A path is an RFC 9535 JSONPath string, limited to two selectors:
- member names: `.lat`, or `['lat']` for a name that is not an identifier;
- the wildcard: `[*]` for each element of a list.

`$` is the column's value. The path ends at the key the operation acts on.

- Parse paths in the SQL family into a list of steps, and use that one parser in both targets.
- When the operation is built, refuse any other JSONPath feature with `CONTRACT.ARGUMENT_INVALID`, naming the path. That includes filters, indexes, slices, `..` and `.*`.
- Refuse a path that does not end at a member name, where an operation needs a key.

Examples: `'$.lat'`, `'$[*].lat'`, `'$.point.lat'`, `'$.history[*].point.lat'`.

## The operations

Each takes `schema?` (left out for a table of the unbound namespace), `table`, `column` and the options below.

| Operation | Options | Class | Effect |
| --- | --- | --- | --- |
| `renameStoredKey` | `path`, `to` | `widening` | Renames the key at `path` to `to` in every object the path reaches |
| `removeStoredKey` | `path` | `destructive` | Removes the key at `path` |
| `fillStoredKey` | `path`, `value` (a JSON value) | `widening` | Sets the key at `path` to `value` in every object that lacks it |
| `deleteRows` | `value`, `codecRef?` | `destructive` | Deletes the rows whose `column` holds the stored value `value` |
| `replaceStoredValue`, `removeStoredValue` | new optional `path` | unchanged | With `path`, act on the value at that path inside JSON, compared as a JSON value |

Rules for every operation:
- Touch only rows that need the change. A row that does not match keeps its value exactly; on SQLite that means byte for byte.
- Never fail on SQL `NULL`, JSON `null`, a missing key, a value of the wrong type, an empty list or a `null` list element. Use the typed strict `jsonpath` style from the grounding on Postgres. A naive strict path misses rows that have a `null` element.
- The postcheck states that no row still needs the change, so a re-run skips finished work.
- `renameStoredKey` refuses to overwrite: when an object already has the key `to`, its precheck fails and changes nothing.
- `deleteRows` takes its value as `replaceStoredValue` takes `from`, with `codecRef`. Its postcheck states that no row holds the value.
- `removeStoredValue` with `path` on a list member removes the element. On a scalar member it sets JSON `null`. Its precheck fails while a required member holds the value, as for a required column, with the `rowsHoldingValue` mark from dispatch 22 and the path in the message.
- None carries an `invariantId`.
- Classify each in `classifyCall` so it lands in the `alter` bucket, between the old check's drop and the new check's add.

## Tests

Write a failing test first for each operation. Run them on PGlite and on SQLite. Cover:
- an object column;
- a list of objects;
- an object nested in an object;
- a list inside an object inside a list;
- SQL `NULL` and JSON `null` columns;
- a `null` list element and an empty list.

Also cover:
- the re-run skip;
- the rename precheck;
- `renderTypeScript` round trip;
- every refused path form.

## Docs

Add the operations to the hand-written operations paragraph of `docs/architecture docs/subsystems/7. Migration System.md`, beside `replaceStoredValue`. Add any new error to `docs/reference/error-reference.md`.

## Rules

- Commit after each operation, so a crash loses little.
- Change nothing in `packages/1-framework`. If you find you must, stop and report it.
- Never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all`. Run named files with `pnpm test <file>` inside `test/integration`. `pnpm test:packages` is allowed.
- Use `mise exec --` for node and pnpm. Never `npx`. Do not write to `/tmp` or any system temp directory. Save slow output under `wip/` in the worktree and read the file. Never use bare `git stash`.
- No comments where the code can say it. No bare `as` casts in production code. No `any`. No file extensions in imports. No backwards-compatibility exports. Don't branch on target; each target implements its own operations.
- No invented nouns: use the names in this brief or in the code. Never hard-wrap Markdown prose.
- Commit with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`. No AI attribution lines (no Co-Authored-By, no "Generated with"). Stage files explicitly.
- Do not push. Do not open a PR.

## Done when

- `pnpm build` is clean; typecheck, lint and `test --coverage` pass in every touched package.
- `lint:deps`, `lint:ratchets` and `check:error-reference` pass.
- The enum value journeys still pass: `enum-value-statements*`.

## Report

Plain English, short sentences: each operation and what you built, the SQL each target writes for one nested list example, the tests that were red first, the checks, anything you could not do and why, and the commits.
