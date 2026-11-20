# Dispatch 5: CLI text and journeys

**Slice plan:** `projects/migration-statements/slices/stored-name-renames/plan-pr1.md`, row 4 · **Spec:** `projects/migration-statements/slices/stored-name-renames/spec.md` (read all of it first) · **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-5072cc` · **Branch:** `tml-3839-stored-name-renames` (tip `3ce10e45e8`) · **Tier:** mid (Opus, medium effort)

Work only inside the worktree. Notes in `wip/stored-name-renames/out/d5-progress.md`, updated as you go. The rules of dispatch 1 (`dispatches/01-table-and-column-renames.md` § Rules) hold, with one change stated under "Framework" below; read them.

## Inputs

- The spec, sections "Text and code that goes away or changes", "Refused in this slice", "`db update` and a database that does not match the origin", "Slice-specific done conditions" 1 to 7.
- `wip/stored-name-renames/code-map.md` section 8 (tests and journeys that encode the old behaviour) and section 9 (framework CLI). It is a lead; read the code.
- `wip/stored-name-renames/out/d4-progress.md`: the table of refusals and the route each one prints.
- `test/integration/test/cli-journeys/README.md` and the existing journeys for how a journey is written and named.
- `drive/calibration/failure-modes.md` F13, F26, F44, F46, F48.

## Outcome

The CLI says what is now true about a kept name whose stored name or stored value changes, and CLI journeys on PostgreSQL and SQLite show every behaviour of the first pull request end to end, **such that every journey reads the data back after the migration is applied, and every printed advice is followed to its end by the journey that shows the refusal**.

### 1. Framework CLI text

In `packages/1-framework/3-tooling/cli/src/control-api/statements/resolve-statements.ts`:

- `STORED_NAME_ONLY` (line 167, used at 811 and 957) and the enum swap hint are reworded. The text must be true for PostgreSQL, SQLite, MySQL and MongoDB as the code stands at the end of this pull request: MySQL plans no rename; MongoDB still plans the old way until the second pull request. Wording to aim for: a name that is kept needs no statement; the plan renames its storage where the target can, and otherwise asks about it. No word that names a family, a target, a table, a column or a collection.
- Rewrite the CLI unit tests that assert these texts.

**Framework.** This is the one permitted change under `packages/1-framework`: text in the CLI package only. No type, interface or behaviour change there, and nothing outside `3-tooling/cli`. If anything else in the framework seems to need a change, stop and report. Do not delete `twoRuns`, `keepsDataByCommand` or `sharesValueWithKeptMember`: MongoDB still reaches them.

### 2. Journeys rewritten

These fail today because they assert the old behaviour. Rewrite each to show the new one. Do not weaken one to make it pass: if a journey fails for a reason other than the old expectation, stop and report.

- `table-map-change.e2e.test.ts` and `table-map-change.sqlite.e2e.test.ts` (M1, M2): the rename is planned with no question, on `migration plan` and on `db update`, and the rows are still there.
- `rename-table-migration.e2e.test.ts` R1 and `rename-table-migration.sqlite.e2e.test.ts` R3, R4.
- `enum-value-statements.e2e.test.ts` E9, E10; `enum-value-statements.sqlite.e2e.test.ts` S4, S7, S9, S10, S11.
- `test/integration/test/cli-journeys/README.md` rows for all of the above and for the new journeys.

Then search `test/integration` and `test/e2e` for any other test or fixture that still expects a drop and a create, a question, or by-hand advice for a stored-name or stored-value change on PostgreSQL or SQLite, and rewrite it. MongoDB and MySQL journeys are not yours; if one fails because of the text change in part 1, update only the asserted text.

### 3. New journeys, on PostgreSQL and SQLite

Put them where a reader would look: extend the file that already owns the subject, or add a file when none does. Keep every file under 500 lines.

1. A field `@map` change: column renamed with no question, both commands, values read back.
2. An enum member that keeps its name and changes its stored value: rows rewritten with no question, both commands, values read back. Include a chain (`A` takes the value `B` had, `B` takes a new one).
3. A `@@map` change together with a column type change, and together with a field rename statement.
4. A `@@map` change together with a removed field: the question names the origin model and field, and `--delete Model.field` answers it.
5. A script that passes `--delete Model` for a `@@map` change, as it had to before: the run is refused as an unused consent. Assert the whole error text.
6. Each refusal, with its advice followed to the end and the data found under the right names afterwards: table swap; column swap; a chain between a statement and a contract change, in both directions, for tables and for columns; takeover of a removed model's table; enum value cycle; a kept member taking a removed member's value; `db update` when the database has both names; `--rename` of a variant on shared storage. For each, on both commands where the command can reach it.
7. Shared storage: a single-table variant moves to its own table and back. No rename is planned and no row of another model moves.
8. `db update` after a rename done by hand, combined with a field `@map` change, a removed field answered with `--delete`, and a field statement.
9. For one refusal that comes from a contract change with no statement, run with JSON error output and assert that the error has no `refusedStatement` and that its text has no "this statement".

Each journey asserts the whole printed output of the step it is about (snapshot or full string), not a substring, unless the existing journeys in that file have a helper that normalises output; then use the helper.

### 4. If a journey shows a defect

If following a printed advice does not work, or a plan loses or misplaces data, that is a defect in dispatches 1 to 4. Fix it in the SQL family or the target, tests first, and say so in the report. If the fix needs a design choice the spec does not make, stop and report.

## Done when

- `mise exec -- pnpm build` and `pnpm fixtures:check` are clean.
- Typecheck, lint and `pnpm test --coverage` pass in the CLI package and every other package you touched.
- Every journey file you touched or added passes, each run by name from `test/integration` (`pnpm test <file>`). Never `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all`. Run one file at a time; they time out when run beside other heavy work.
- `pnpm lint:deps`, `pnpm lint:ratchets`, `pnpm check:error-reference` pass.
- The MongoDB and MySQL journeys that print the texts of part 1 pass: `keep-documents-advice.mongo`, `enum-value-statements.mongo`, `delete-statements-migration.mongo`, and any MySQL journey that prints them.
- `git diff --stat $(git merge-base HEAD origin/main) HEAD -- packages/1-framework` lists only files under `3-tooling/cli`.

## Report

Plain English, short: what is now true; the two new texts in full; each journey rewritten and each added, with the done condition it shows; for each refusal, the advice and what the journey did to follow it; any defect found and fixed; anything in spec done conditions 1 to 7 that no journey shows for the SQL targets, and why; the commits; the checks with results.
