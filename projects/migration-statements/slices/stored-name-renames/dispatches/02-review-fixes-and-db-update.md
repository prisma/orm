# Dispatch 2: review fixes for dispatch 1, then the `db update` rows

**Slice plan:** `projects/migration-statements/slices/stored-name-renames/plan-pr1.md`, rows 1 (rework) and 2 · **Spec:** `projects/migration-statements/slices/stored-name-renames/spec.md` (re-read "Storage is renamed only when all of it moves", "Refused in this slice" and "`db update` and a database that does not match the origin"; the first two changed after review) · **Review to fix:** `projects/migration-statements/slices/stored-name-renames/reviews/pr1/dispatch-1-review.md`, with probes in `wip/stored-name-renames/review-d1/` · **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-5072cc` · **Branch:** `tml-3839-stored-name-renames` (tip `d28bcf2747` plus doc commits) · **Tier:** mid (Opus, medium effort)

Work only inside the worktree. Notes in `wip/stored-name-renames/out/d2-progress.md`. The rules of dispatch 1 (`dispatches/01-table-and-column-renames.md` § Rules) hold unchanged; read them.

## Part A — review fixes (commit these first)

Fix the class, not the instance: for each finding, look for the same defect elsewhere in the diff of dispatch 1.

1. **R01.** An origin model or field the destination removes does not block a rename, for statements and for contract changes, for tables and for columns. `--rename Task:Job` with a single-table variant removed plans again, as it did before dispatch 1. A base `@@map` change with a variant removed plans one table rename, and the removed variant's rows are asked about as usual on the renamed table.
2. **R02.** A table or column change is a rename only when every destination object stored in the new name is new or is paired with an origin object stored in the old name. When that fails and no statement is involved, no rename is planned and the plan is today's. When a statement is involved, it is refused as now. So an own-table variant joining its base's table while the base's table is renamed plans as today, and two models that move into one new table with no statement plan as today.
3. **R03.** No refusal advises editing a `migration.ts` that the refused command never writes. Use the existing hand-written-migration advice (`handWrittenMigrationAdvice`), and check every advice text added in dispatch 1 the same way: follow it against the planner and make sure each step is possible.
4. **R04.** Every name comparison in the check uses the target's comparison, including "two renames share a new name". Tests on SQLite for tables and columns.
5. **R05.** A namespace rename statement pairs the models of that namespace by name, so a `@@map` or `@map` change inside a renamed namespace is planned as a rename. If this turns out to need more than the pairing (say so in the report with the reason), stop that item and record it in `projects/migration-statements/deferred.md` instead.
6. **R06.** `keepTableAdvice` no longer says a statement cannot rename the table of a model that keeps its name. It is reached now only when the storage is not renamed (not `managed`, shared, or a target without rename planning); say what is true in those cases.
7. **R07.** Correct the PostgreSQL planner comments that say `db update` passes no origin contract.
8. **R08.** Refusal tests assert the whole conflict; plan tests assert the whole operation list; the control-policy test covers `tolerated`.
9. **R09.** One definition of `modelsStoring`.

## Part B — `db update` against a live database

**Outcome.** When the working schema is the live database, a table or column rename that no statement asks for follows the spec's table, **such that a database whose rename was already done is treated as renamed for the rest of the plan, and no operation is planned on a name that is not there**.

| Live database | Result |
| --- | --- |
| Old present, new absent | Planned (already true) |
| Old absent, new present | No operation. The planner records that the origin table or column is now at the new name, exactly as a planned rename does: field renames on that table, statement or not, plan against the new table name; questions about its columns are named by the origin model and field; `--delete User.field` answers them. |
| Old absent, new absent | No operation, nothing recorded; the storage diff creates the object, as today. |
| Old present, new present | Refused with its own text: it names both stored names, says the likely cause (the rename was half done by hand, or something created the new table before `db update` ran), and the fix: move the rows into the old table or drop the new one, then run again. No `refusedStatement`, never the word "statement". |

The same four rows apply to a column on a table that is present.

Tests against a live database, PostgreSQL (the adapter package's PGlite integration tests) and SQLite, for each row, plus: a table renamed by hand combined with a field `@map` change in the same `db update`; with a removed field answered with `--delete User.field`; with a field rename statement. Assert the planned operations and, after applying, that the rows are still there.

## Not in this dispatch

Enum stored values, CLI text in `packages/1-framework`, journeys, docs. If a journey fails because of your change, list it; do not rewrite it. Journeys already known to fail and owned by dispatch 4: `table-map-change` (both targets) M1.05 and M2.04, `rename-table-migration` R1.05, `rename-table-migration.sqlite` R3.05 and R4.04.

## Done when

- `mise exec -- pnpm build` and `pnpm fixtures:check` are clean.
- Typecheck, lint and `pnpm test --coverage` pass in the SQL family package, the PostgreSQL and SQLite target packages and their adapter packages.
- `pnpm lint:deps` and `pnpm lint:ratchets` pass.
- The SQL journeys that passed after dispatch 1 still pass, each run by name: rename-statements, delete-statements, variant-statements (PostgreSQL and SQLite), move-statements, namespace-statements, pascal-case-table, prisma7-source, prisma7-migration-ledger, plans-with-no-operations, value-object-statements, enum-value-statements, required-field-advice, convert-backfill.
- `git diff --stat $(git merge-base HEAD origin/main) HEAD -- packages/1-framework` is empty.

## Report

Plain English, short: per review finding, what changed and the test that was red first; per `db update` row, the tests; journeys that now fail and why; anything the spec got wrong; commits; checks run with results.
