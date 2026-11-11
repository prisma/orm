# Dispatch 30: fixes from review round 2 and manual QA

**Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/pollyanna-30-context-6ee51c/wip/wt-pr4` · **Branch:** `tml-3537-value-object-variant-statements` · **Inputs:** the "Round 2" sections of `projects/migration-statements/slices/remaining-nouns/reviews/pr4/system-design-review.md` and `code-review.md` in the worktree, and the QA report `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/pollyanna-30-context-6ee51c/projects/migration-statements/manual-qa-reports/2026-10-30-qa-3b-pr4.md`. Read all three first. QA's scratch projects are under `wip/qa-pr4/` in the worktree; reuse them to reproduce.

Work only inside the worktree. Write a failing test first for every behaviour change. A message change needs a test that asserts the new text.

## Defects

1. **`db migrate` applies a migration whose placeholders are unfilled.** On SQLite a `--backfill` migration with unfilled placeholders has `ops.json` `[]`; `db migrate` runs 0 operations and moves the marker, and the rows lack the required field. Make `db migrate` refuse a migration whose placeholders are unfilled, naming the migration and telling the user to fill the placeholder and run `node migration.ts`. This replaces the Postgres "missing check" failure for the same case (QA F3). Find where the migration package records unfilled placeholders; read that. If the refusal needs a new framework type or field, stop and report it.
2. **Postgres `Json` columns.** A `renameStoredKey` on a `json` (not `jsonb`) column fails at apply with `CLI.UNEXPECTED` "function jsonb_path_exists(json, unknown) does not exist". Make every path operation work on a `json` column too (cast to `jsonb` to read, write back as the column's type), or, if the type cannot be known, explain why in the report. Test on PGlite with a `Json` column.
3. **SQLite accepts wrong `--backfill` values for enum, list and value object fields** (review round 2). Check the value against the field fully when the call is built: an enum value against its value set, each list element against the element's type, a value object field by field, recursively, with the same data type check. Refuse with `CONTRACT.ARGUMENT_INVALID`.
4. **SQLite cascade fallback.** `references[index] ?? column` falls back silently. Make a missing reference an error.

## Messages

5. **A refused backfill value** names the field (`Address.country`) and its type in contract terms, not the codec id or the path. It is printed once (QA F12; review round 2). An unknown codec is its own error.
6. **`--rename GeoPoint:Geo`:** remove the advice to leave value object fields out of the statements; value object fields are statements now (QA F4).
7. **`--rename Site.location.lat:…`:** say to name the field through its value object, for example `GeoPoint.lat` (QA F5).
8. **A renamed value object field with no statement** (QA F6): `migration plan` and `db update` ask the same question, it names every column and path, and the `--delete` option says the new field then gets the temporary value or needs `--backfill`.
9. **A removed variant with a new sibling** suggests `--rename Bug:Issue`, with the real name, as the field questions do (QA F7).
10. **Long questions** list paths as a list, one per line, not one sentence (QA F8).
11. **A removed enum value in a required field** (QA F9): the failure names every path; the by-hand advice quotes calls exactly as `migration.ts` writes them; the `db update` route covers values inside a list.
12. **The temporary-value warning** is printed once per field, not once per column (QA F10).
13. **`migration plan --backfill`** lists the fill operations in its output, on both targets (QA F11).
14. **`db update` backfill refusals** say which reason applies to the field; the text no longer says `--convert` needs a migration file (QA F13).
15. **SQLite variant questions** (QA F14): the foreign key paragraph only when a foreign key references the rows; the own-table delete label says the variant table's rows are deleted too; table and column names quoted as on Postgres.
16. **Wildcard precheck** (QA F15): show the path as the user wrote it; when a row holds both keys, say that, not "drift".
17. **SQLite foreign key failure** (QA F16): list the tables in the human output.
18. **Postgres SQL preview** (QA F17): include the data rewrites. If the preview leaves out data operations by design for every operation, report that and leave it.
19. **Operation count** (QA F18): when `db migrate` applies fewer operations than the migration holds, say why. If that needs a framework type change, stop and report it.

## Design

20. **Rename `VariantRowRewrite.variantTable`** to a name that says it holds the table whose foreign key cascades.
21. **`describeDataStatement`** switches on the statement's kind, not on `entity === 'model'`, so a new statement kind fails to type-check. This is display code in the CLI; change no framework type.
22. **Test key order** after a SQLite object rewrite: compare the stored text, not parsed JSON.

## Deferred

23. Record in `projects/migration-statements/deferred.md`:
   - On SQLite, tables other than the variant's own table whose foreign keys cascade to the variant or base table still make the apply fail with `MIGRATION.FOREIGN_KEY_VIOLATION`; nothing is left broken.
   - The dictionary refusal could plan `.*` paths now.
   - A hand-written migration with only data rewrites and no contract change is refused as a "no-op self-edge" (QA F19).

## PR text

24. Update `wip/pr4-description.md` for anything above that a user sees.

## Rules

- Commit after each item, so a crash loses little.
- In `packages/1-framework`, change only CLI code (items 1, 12, 13, 17, 19, 21 may need it). Change no framework type and add no field to one. If you find you must, stop and report it.
- Never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all`. Run named files with `pnpm test <file>` inside `test/integration`, and journeys with `pnpm test:journeys <file>`. `pnpm test:packages` is allowed.
- Use `mise exec --` for node and pnpm. Never `npx`. Do not write to `/tmp` or any system temp directory. Save slow output under `wip/` in the worktree and read the file. Never use bare `git stash`.
- No comments where the code can say it. No bare `as` casts in production code. No `any`. No file extensions in imports. No backwards-compatibility exports. Don't branch on target.
- No invented nouns: use the names in this brief or in the code. Never hard-wrap Markdown prose.
- Commit with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`. No AI attribution lines (no Co-Authored-By, no "Generated with"). Stage files explicitly. Never amend, rebase or force-push.
- Do not push. Do not open a PR.

## Done when

- `pnpm build` and `fixtures:check` are clean; typecheck, lint and `test --coverage` pass in every touched package.
- `lint:deps`, `lint:ratchets`, `check:error-reference` and `check:upgrade-coverage` pass.
- These journeys pass: `enum-value-statements*`, `value-object-checks`, `plans-with-no-operations*`, `variant-statements*`, `required-field-advice*`, `value-object-backfill*`, `value-object-statements*`, and any CLI journey that covers `db migrate` with placeholders.

## Report

Plain English, short sentences: each item and what you did, what you left and why, the tests that were red first, the checks, and the commits.
