# Dispatch 31: fixes from review round 3

**Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/pollyanna-30-context-6ee51c/wip/wt-pr4` · **Branch:** `tml-3537-value-object-variant-statements` · **Inputs:** the "Round 3" sections of `projects/migration-statements/slices/remaining-nouns/reviews/pr4/code-review.md` and `system-design-review.md` in the worktree. Read both first.

Work only inside the worktree. Write a failing test first for every behaviour change.

1. **`migration plan` refuses without `--backfill`, in every case.** Today, when a value object gains a required field and also loses a field that no statement renames, `migration plan` writes a placeholder fill that no statement asked for. Statements are intent: the planner fills a field only when `--backfill` names it.
   - Remove that placeholder fill. `migration plan` asks about the lost field first, offering `--rename` as it does now.
   - After `--delete` answers it, `migration plan` still refuses for the new field, naming `--backfill`.
   - The refusal lists every column and path, and offers the rename first while a field is lost and not renamed.
   - `db update` keeps its temporary value.
   - Add a journey step for the `--delete` path through to the refusal, then `--backfill`, fill, `node migration.ts`, `db migrate`.
   - Update the Migration System doc, the error reference and the PR text to match.
2. **The unfilled placeholder check in `db migrate`.** It searches `migration.ts` text for `placeholder(`. It is fooled by comments, strings, a user's own `placeholder` function, an import under another name, and a call from a helper file.
   - If a TypeScript parser is already a dependency of the CLI package, parse `migration.ts`: find the local name of the `placeholder` import from the Prisma package and look for calls to it.
   - Otherwise do the same with a scan that first strips comments and strings, then finds the import's local name, then its calls.
   - Test each case above. A call from a helper file stays a known gap: say so in the error reference.
   - Do not add a field to the migration package or to any framework type.
3. **Rename precheck advice.** The failed-precheck advice now begins "if the check is about the rows…" for every precheck, including schema checks. Give the `renameStoredKey` precheck its own advice, and restore the earlier advice for every other precheck.
4. **`fillStoredKey` checks `field` against `path`.** Refuse a call whose `field` does not name the key the path ends at, with `CONTRACT.ARGUMENT_INVALID`.
5. **Docs: `json` columns on Postgres.** Say in the Migration System doc that on a `json` column each row a path operation rewrites is stored in `jsonb` form: key order and spacing change, and duplicate keys collapse to the last one. Rows the operation leaves alone keep their text.
6. **`deferred.md`:** record, as a question for Will, that a migration package does not record unfilled placeholders, so `db migrate` must read `migration.ts`. Recording them needs a new `MigrationMetadata` field, which changes the on-disk format and the hash. `migration new` has the same gap: a migration the user forgot to emit is applied as zero operations.
7. **PR text:** update `wip/pr4-description.md` for items 1, 2 and 5.

## Rules

- Commit after each item, so a crash loses little.
- In `packages/1-framework`, change only CLI code. Change no framework type and add no field to one. If you find you must, stop and report it.
- Never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all`. Run named files with `pnpm test <file>` inside `test/integration`, and journeys with `pnpm test:journeys <file>`. `pnpm test:packages` is allowed.
- Use `mise exec --` for node and pnpm. Never `npx`. Do not write to `/tmp` or any system temp directory. Save slow output under `wip/` in the worktree and read the file. Never use bare `git stash`.
- No comments where the code can say it. No bare `as` casts in production code. No `any`. No file extensions in imports. No backwards-compatibility exports. Don't branch on target. Add no new package dependency.
- No invented nouns: use the names in this brief or in the code. Never hard-wrap Markdown prose.
- Commit with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`. No AI attribution lines (no Co-Authored-By, no "Generated with"). Stage files explicitly. Never amend, rebase or force-push.
- Do not push. Do not open a PR.

## Done when

- `pnpm build` and `fixtures:check` are clean; typecheck, lint and `test --coverage` pass in every touched package.
- `lint:deps`, `lint:ratchets`, `check:error-reference` and `check:upgrade-coverage` pass.
- These journeys pass: `enum-value-statements*`, `value-object-checks`, `plans-with-no-operations*`, `variant-statements*`, `required-field-advice*`, `value-object-backfill*`, `value-object-statements*`, `convert-backfill*`, `data-transform-strategies`, `invariant-routing`.

## Report

Plain English, short sentences: each item and what you did, the tests that were red first, the checks, anything you could not do and why, and the commits.
