# Dispatch 27: a value for a new required value object member

**Plan:** [`../plan-pr4.md`](../plan-pr4.md) · **Grounding:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/pollyanna-30-context-6ee51c/wip/pr4-grounding.md`, section 4 and decisions B3, B5 · **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/pollyanna-30-context-6ee51c/wip/wt-pr4` · **Branch:** `tml-3537-value-object-variant-statements` (dispatches 21–26 are committed there)

Work only inside the worktree.

When a user adds `country String` to `GeoPoint`, existing rows have no `country` key, and on Postgres PR 3's shape check refuses them at apply. The same happens when an optional member becomes required, for rows that lack it or hold JSON `null`. Today nothing handles either case. Dispatch 21 resolves `--backfill GeoPoint.country`. Dispatch 23 added `fillStoredKey`. Dispatch 24 added `valueObjectPlaces`, which finds every column and path that holds a value object.

## Behaviour

1. **`migration plan --backfill GeoPoint.country`** writes one `fillStoredKey` per column and path, with `value: placeholder('GeoPoint.country:value')`, beside the diff like the other rewrites. On Postgres that is between the old shape check's drop and the new one's add.
   - The fill sets the key in objects that lack it, and in objects where it is JSON `null` when the member is becoming required.
   - Teach `fillStoredKey` to take an unfilled value: until the user replaces the placeholder, `ops.json` stays empty with `pendingPlaceholders`, as 3a's backfill data transform does.
   - Fill the statement's operation positions through dispatch 22's outcome.
2. **`migration plan` without `--backfill`**, when the origin is known: refuse at plan time, naming `--backfill GeoPoint.country`. 3a's `backfillOfDefaultedField` is the precedent for a plan-time refusal.
3. **`db update` without `--backfill`.**
   - For a scalar member whose codec has a temporary value, plan `fillStoredKey` with that value. Report it in `temporaryValues`, with the `valueObjectField` subject, as a new required column is reported. The CLI prints the line naming the value and the `--backfill` statement that lets the user choose it.
   - For a member that is a value object or an enum, or whose codec has no temporary value, refuse, naming `migration plan --backfill`.
4. **A member that already has a default** is not filled by `--backfill`, as `backfillOfDefaultedField` refuses for columns. Check whether value object members can carry defaults. If they cannot, say so in the report and skip this item.

## A check from dispatch 26

5. Dispatch 26 found that the canonicalizer drops empty objects. It fixed this for SQL in the SQL family's canonicalization hook, so a variant with no fields keeps `fields: {}`. Check whether a MongoDB variant with no fields of its own fails the same way:
   - write a PSL schema with one;
   - emit it;
   - validate it.

   If it fails, fix it in the Mongo family's hook in the same way, with a failing test first. Do not change the framework canonicalizer.

## Tests

Write a failing test first for every behaviour.
- **Planner tests on both targets:** a new member, an optional member made required, a list path, a nested path, the refusal without `--backfill`, and `db update`'s temporary value and refusals.
- **Integration tests on PGlite and SQLite:** fill the placeholder, run the `migration.ts`, apply it and read the JSON back. On Postgres, check that the new shape check passes.
- **A journey:** `migration plan --backfill`, then filling the placeholder, then `node migration.ts`, then `db migrate`.

## Docs

Update the Migration System doc's convert and backfill section, and its table, and the CLI README's `--backfill` text. Update the error reference for any new message.

## Rules

- Commit after each behaviour, so a crash loses little.
- In `packages/1-framework`, change only CLI code where the CLI must print or handle the new temporary value. Change no framework type. If you find you must, stop and report it.
- Never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all`. Run named files with `pnpm test <file>` inside `test/integration`, and journeys with `pnpm test:journeys <file>`. `pnpm test:packages` is allowed.
- Use `mise exec --` for node and pnpm. Never `npx`. Do not write to `/tmp` or any system temp directory. Save slow output under `wip/` in the worktree and read the file. Never use bare `git stash`.
- No comments where the code can say it. No bare `as` casts in production code. No `any`. No file extensions in imports. No backwards-compatibility exports. Don't branch on target.
- No invented nouns: use the names in this brief or in the code. Never hard-wrap Markdown prose.
- Commit with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`. No AI attribution lines (no Co-Authored-By, no "Generated with"). Stage files explicitly.
- Do not push. Do not open a PR.

## Done when

- `pnpm build` and `fixtures:check` are clean; typecheck, lint and `test --coverage` pass in every touched package.
- `lint:deps`, `lint:ratchets` and `check:error-reference` pass.
- These journeys pass: `enum-value-statements*`, `value-object-checks`, `plans-with-no-operations*`, `variant-statements*`, `required-field-advice*`, and the new one.

## Report

Plain English, short sentences: each behaviour and what you did, the `migration.ts` the planner writes for `--backfill GeoPoint.country` on a list path, the result of the MongoDB check, the tests that were red first, the checks, anything you could not do and why, and the commits.
