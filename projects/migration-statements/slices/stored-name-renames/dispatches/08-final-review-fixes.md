# Dispatch 8: fixes for the final code review

**Reviews to fix:** `projects/migration-statements/slices/stored-name-renames/reviews/system-design-review.md` (findings S01 to S09 and the ADR gap) and `reviews/code-review.md` (F01 to F04). Read both in full; they have evidence and proposed fixes. Probes: `wip/stored-name-renames/review-final/` · **Spec:** `projects/migration-statements/slices/stored-name-renames/spec.md` · **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-5072cc` · **Branch:** `tml-3839-stored-name-renames` (tip `9561a4338b` plus this brief) · **Tier:** mid (Opus, medium effort)

Work only inside the worktree. Notes in `wip/stored-name-renames/out/d8-progress.md`. The rules of dispatch 1 (`dispatches/01-table-and-column-renames.md` § Rules) hold, with the framework exception: text in the CLI package only. Fix the class, not the instance. Behaviour does not change in this dispatch except where a finding says so; the existing tests and journeys must still pass with only the assertions on changed text updated.

1. **F01.** Every document that quotes or paraphrases a refusal says what the code prints at the tip. Start with the "rename or drop" a reused table text in ADR 324, `docs/reference/error-reference.md` and `docs/architecture docs/subsystems/7. Migration System.md`, then compare every quoted refusal and CLI text in those three, in `skills/prisma-8/references/migrations.md`, the CLI `README.md`, and `upgrade-instructions/pending/sql-stored-name-renames/app/instructions.md` against the source. List each quote and its source line in your notes.
2. **F02.** `storage-renames.ts` does no work that grows faster than the number of fields: drop fields whose column does not change before grouping, and key groups in a `Map`. Compare names through the target's comparison still. Add a test that would fail if a kept model's unchanged fields were grouped (assert on behaviour, not on time).
3. **F03.** The enum swap hint in `resolve-statements.ts` states a fact that is true on every target and implies no working plan: a member that keeps its name needs no statement, and stored values that trade places take two plans, through a value no member stores. Update its unit test.
4. **S01 and F04.** One definition of "this table's models split or merge", used by both the planner (`StorageRenames.sharedTable`) and the advice (`sharedStorageAdvice` in `operation-subjects.ts`). It pairs through rename statements and compares names as the target does. `modelsStoring` has no default comparison. One `sameTable`. Tests show the advice and the planner agree when a statement renames a model and when names differ only in case on SQLite.
5. **S02.** A target states its name comparison once. `tablesNamed`, `columnsNamed` and `sameName` come from that one place, and PostgreSQL does not copy `exactName`.
6. **S09 and F04.** One helper that joins a list into text, in a module whose name is not about renames; `listText` and `listed` go.
7. **S04.** `TableChange` and `TableRename`, and the column pair: each doc comment says in one line what it is and names its counterpart. A kept model whose table does not change does not become a `ModelRename` if that can be done without behaviour change; if not, say why in the report.
8. **S05.** `SharedStorage.kind` uses `'split' | 'merged'`.
9. **S06.** `madeTables`, the `'made'` disposition and `onMadeTable` are named in the ADR's words for "the database already has the table under its new name". Use words the code or ADR 324 already has; do not coin a term.
10. **S07 and S08.** `skills/prisma-8/references/migrations.md` and the upgrade fragment say what the code does: chains of enum stored values are planned on PostgreSQL and SQLite; enum swaps were asked about before, not planned silently; and pitfall 14 states that `migration plan` reports no change for a swap between tables or columns of the same shape, while `db update` refuses it.
11. **The ADR gap.** ADR 324's refusal table has a row, or a pointer under it, for a statement and a model that keeps its name both moving into one new table name.
12. **S03, not fixed here.** Add an entry to `projects/migration-statements/deferred.md`: `planStatements`, `PlannedStatements`, `StatementPlanner`, `StatementPlanningTarget` and their test files now also plan renames no statement asks for, and their names still say "statement". Renaming them is a wide change to names that exist on `main` and needs names chosen by the operator.
13. Add the paragraph about the CLI offering a refused rename again to `deferred.md` if it is not there (text in `wip/stored-name-renames/out/d7-progress.md`).

## Done when

- `mise exec -- pnpm build` and `pnpm fixtures:check` are clean.
- Typecheck, lint and `pnpm test --coverage` pass in the CLI package, the SQL family, and the PostgreSQL and SQLite target and adapter packages.
- `pnpm lint:deps`, `pnpm lint:ratchets`, `pnpm lint:docs`, `pnpm check:error-reference`, `pnpm check:upgrade-coverage --prev $(git merge-base HEAD origin/main)` pass.
- These journeys pass, each run by name, one at a time, from `test/integration`: `table-map-change`, `field-map-change`, `stored-name-refusals`, `stored-name-chains-and-merges`, `stored-name-db-update`, `variant-storage-moves`, `enum-stored-values` (PostgreSQL and SQLite files of each). Never `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all`.
- `git diff --stat $(git merge-base HEAD origin/main) HEAD -- packages/1-framework` lists only CLI package files, text only.
- `git status` is clean.

## Report

Plain English, short: each finding and what is now true; the enum swap hint in full; the names chosen for S06 and where they come from; anything not done and why; commits; checks with results.
