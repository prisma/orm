# Dispatch 9: fixes for the follow-up review and manual QA

**Review to fix:** `projects/migration-statements/slices/stored-name-renames/reviews/follow-up-review.md` (F05 to F08, S10, S11; read all of it). **Manual QA transcripts:** `wip/stored-name-renames/qa/` (`o1-enum-swap-by-hand-pg.txt`, `s4-etake-pg-plan-precheck.txt`, `s3-*.txt`, `s5*.txt`) · **Spec:** `projects/migration-statements/slices/stored-name-renames/spec.md` · **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-5072cc` · **Branch:** `tml-3839-stored-name-renames` (tip `47d56da977`, a merge of `main`, plus this brief) · **Tier:** mid (Opus, medium effort)

Work only inside the worktree. Notes in `wip/stored-name-renames/out/d9-progress.md`. The rules of dispatch 1 (`dispatches/01-table-and-column-renames.md` § Rules) hold, with the framework exception: text in the CLI package only. Fix the class, not the instance. Run `mise exec -- pnpm install --frozen-lockfile` and a full `pnpm build` first: the tree was just merged with `main`.

## From the review

1. **F05.** `upgrade-instructions/pending/sql-stored-name-renames/extension/instructions.md` exists and tells an extension or target author what changed in the SQL family's public control exports against `main`, each with before and after: `SchemaTables` gains a required `sameName`; the context passed to `subjectsOfCalls` gains a required field (named as item 5 leaves it); `keepDataEdit` is gone from `CallSubjects`; the new exports. Check the list against `git diff origin/main...HEAD` of the family's `exports/` and the types they export, and add anything missing. Follow `skills-contrib/record-upgrade-instructions/SKILL.md`.
2. **F06.** A MySQL planner test asserts the whole `keepDataAdvice` for a `@@map` change (drop and create), so the advice cannot vanish unnoticed. It needs no MySQL server.
3. **F07.** The scale test states its time limit in the test and its title says what it shows.
4. **F08.** The upgrade fragment's quoted operation labels are right for each target it names.
5. **S10.** The `StorageRenames` field on `PlannedStatements` and on the advice context is named `storageRenames`; inside `planStatements` each local is named for what it holds.
6. **S11.** The doc comments of `TableRename` and `ColumnRename` name `TableChange` and `ColumnChange`, one line each.

## From manual QA

7. **A hand-written route that fails on PostgreSQL.** The refusals for an enum stored-value cycle and for a member that takes a removed member's value offer, second, a hand-written migration with `replaceStoredValue`. On PostgreSQL an enum stored as text or integer has a check constraint that lists the values, so the literal advice fails at apply (`o1-enum-swap-by-hand-pg.txt`), and the user cannot know the new constraint's name. Rule: a refusal offers a route only if a user can follow it to the end on every target that prints it, using only what the text gives. Either the text gives everything needed through what the target already tells the family (no branch on the target, no new framework interface), or the hand-written route is not offered and the two-plan route stands alone. Then check every other hand-written route this pull request's refusals offer the same way, on PostgreSQL and SQLite, by following it in a journey or adapter test. Update ADR 324, the error reference and the other docs that quote the texts.
8. **A first step that cannot be applied.** The refusal for a member that takes a removed member's value says to remove the holder first, in a plan "which asks about its rows". When the column is required, that plan's migration fails its precheck while rows still hold the value (`s4-etake-pg-plan-precheck.txt`). The text says what the user must do with those rows before the first plan applies. Follow it in a journey on both targets with a required column.
9. **Takeover of a removed model's table** says to remove the model (by its contract name), not "remove table".
10. **The "database has both names" refusal** reads as two separate cases, each with its fix, and says plainly whose rows "its rows" are. Keep it one conflict; make the text unambiguous. Tables and columns.
11. **SQLite operation labels quote names** as PostgreSQL's do (`Rename table "Shop Front" to "Store Front"`), for the rename operations this pull request plans. If the unquoted labels predate this branch and changing them touches more than about ten files, do not change them; say so in the report and give the paragraph for `deferred.md`.

## Not yours

- `CLI.CONSENT_UNUSED` text, the `public.` prefix in model names in refusals, the DDL preview leaving out the value rewrite, and the `migration plan` shortcut on equal storage hashes. Add one `deferred.md` entry for the first three if absent, each with the command and output from the QA transcripts.

## Done when

- `mise exec -- pnpm build` and `pnpm fixtures:check` are clean.
- Typecheck, lint and `pnpm test --coverage` pass in the CLI package, the SQL family, the PostgreSQL and SQLite target and adapter packages, and the MySQL target (tests without a server).
- `pnpm lint:deps`, `pnpm lint:ratchets`, `pnpm lint:docs`, `pnpm check:error-reference`, `pnpm check:upgrade-coverage --prev $(git merge-base HEAD origin/main)` pass.
- Every journey file under `test/integration/test/cli-journeys/` that this branch added or changed passes, each run by name, one at a time (`git diff --name-only origin/main...HEAD -- test/integration/test/cli-journeys`). Also `pnpm test` for the planner golden tests under `test/integration` that cover PostgreSQL and SQLite migration planning, by file name. Never `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all`.
- `git diff --stat $(git merge-base HEAD origin/main) HEAD -- packages/1-framework` lists only CLI package files, text only.
- `git status` is clean.

## Report

Plain English, short: each item and what is now true; each refusal text you changed, in full; for item 7, each hand-written route, whether it stays, and how you followed it; anything not done and why; commits; checks with results.
