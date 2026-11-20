# Dispatch 7: review fixes for the CLI text and journeys

**Review to fix:** `projects/migration-statements/slices/stored-name-renames/reviews/pr1/dispatch-5-review.md` (read all of it; it has evidence and proposed fixes), probe in `wip/stored-name-renames/review-d5/` · **Spec:** `projects/migration-statements/slices/stored-name-renames/spec.md` · **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-5072cc` · **Branch:** `tml-3839-stored-name-renames` · **Tier:** mid (Opus, medium effort)

Work only inside the worktree. Notes in `wip/stored-name-renames/out/d7-progress.md`. The rules of dispatch 1 (`dispatches/01-table-and-column-renames.md` § Rules) hold, with the framework exception of dispatch 5: text in the CLI package only. Another implementer is editing documents (`docs/`, `skills/`, `upgrade-instructions/`, `projects/migration-statements/*.md`, the CLI `README.md`) at the same time: do not touch those files, stage by explicit path, and run no git command that changes files you did not change.

Fix the class, not the instance.

1. **R18.** `STORED_NAME_ONLY` and the enum swap hint make no claim about what the plan does instead. They say only that a model, field or member that keeps its name needs no statement, and to leave the statement out. Follow each text on PostgreSQL, SQLite, MySQL and MongoDB as the code stands and record, per target, what the user sees next. Update the CLI unit tests and any journey that prints the texts.
2. **R20, the part outside the framework.** The shared-storage refusal of a statement (`statement-planning.ts`, near line 262) says that the plan without the statement asks about the model's data, that the question offers the same rename again, and that `--delete <Model>` is the answer that works. Journey J2 asserts the new text. Do not change the framework. Add a `deferred.md`-ready paragraph to your report (do not edit `deferred.md`): the CLI offers a rename the planner has just refused, where it is built (`plan-questions.ts` `dataLossQuestion`, `renameForm`), and the two fixes the review names.
3. **R21.** `enum-value-statements.e2e.test.ts` is under 500 lines: E4 to E8 move to their own file, shared helpers to a utility file. README rows follow.
4. **R22.** `expectSettled` checks that nothing is left to do in a way that can fail: `db update --dry-run` against the database reports no operations. Remove any step that cannot fail.
5. **R23.** Journeys, PostgreSQL and SQLite, both commands where reachable: a chain of two contract changes for tables and for columns, refused, advice followed, rows read back; a merge that involves a statement, refused, advice followed; two models moving to one new table name with no statement, where no rename is planned and no row of another model moves.
6. **R24.** In the "database has both names" refusal, the reused-old-name route says to drop the reused table or column, or to move its rows or values elsewhere first; it does not say rename. The main route does not tell a user to copy rows that are already in the old table. A test follows the column route (values moved, new column dropped, next run plans the rename) against a live database on both targets.
7. **R25.** J2 also follows the route that keeps `Bug`'s rows, if the refusal offers one. If that route cannot be followed with what the CLI gives a user, the refusal must not offer it: fix the text and say so in the report.
8. **R26.** M5.05 and any like it assert the whole rows.

**Not yours:** R19, the `migration plan` shortcut on equal storage hashes. It is in the framework and waits for a decision. Keep the swap journeys on models and fields of different shapes.

## Done when

- `mise exec -- pnpm build` and `pnpm fixtures:check` are clean.
- Typecheck, lint and `pnpm test --coverage` pass in every package you touched.
- Every journey file you touched or added passes, run by name, one at a time, from `test/integration`. Never `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all`.
- `pnpm lint:deps`, `pnpm lint:ratchets`, `pnpm check:error-reference` pass.
- `git diff --stat $(git merge-base HEAD origin/main) HEAD -- packages/1-framework` lists only CLI package files, text only (the README there is the other implementer's).

## Report

Plain English, short: each finding and what is now true; the two CLI texts in full; per target, what follows each text; each refusal text you changed, in full; the `deferred.md` paragraph; commits; checks with results.
