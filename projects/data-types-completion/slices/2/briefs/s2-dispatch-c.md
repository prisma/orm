# Slice 2, dispatch c: `db sign` over every space; `migrate` names `db sign`

Dispatch c of `projects/data-types-completion/slices/2/plan.md`. Read the slice plan, design section 8 (both items), `design-notes.md` "Q1a. Databases are re-signed with `db sign`", inventory `upgrade-rewrite.md` section 5 (what `db sign` does today, with file and line pointers, and the two decisions the design settled: sign every space; `migrate` names `db sign`), and `slices/2/build-review.md`.

Build exactly design section 8:

1. `db sign` loads the aggregate with `contract-space-aggregate-loader.ts`, as `migrate` does. It verifies each space with `strict: false`. It then opens a transaction through a new `SqlControlAdapter.withTransaction(driver, fn)` (Postgres and SQLite: `BEGIN`, `COMMIT`, `ROLLBACK`), writes the marker of every space that verified, commits, and then advances each signed space's `db` ref and writes its snapshot. A space that failed verification is not signed and is reported with its drift; the command then exits with code 4. The output names each space and whether it was signed, unchanged, or failed.
2. The `MIGRATION.MARKER_MISMATCH` refusal of `migrate` (`packages/1-framework/3-tooling/cli/src/utils/cli-errors.ts`) adds the fix line that `migration status` already uses for `db sign`.

Tests, red first: unit tests for `withTransaction` on both adapters (commit on success, rollback on a thrown error, the error rethrown); a CLI test for the `migrate` message; two journeys through the CLI test app fixtures, one on PGlite with pgvector and one on SQLite, where a database signed with old markers for the app space and an extension space is re-signed by one `db sign` run, after which `db verify`, `migrate` (reports up to date) and `migration status` (no warning) succeed; and a journey where one space fails verification: no marker changes, drift is reported, exit code 4. Follow `.agents/rules/cli-e2e-test-patterns.mdc` and `cli-error-handling.mdc`.

Out of scope: the upgrade script (dispatch d), docs (dispatch f).

Done when: tests red first then green; the CLI, family-sql, adapter-postgres and adapter-sqlite package tests pass except fixture-reading tests already listed in the slice plan; root typecheck for the touched packages; `lint:agent`; `lint:deps`; `check:error-reference` if a code or fix text changed. Report in under 300 words: commits, the exact `db sign` output format, anything the design left undecided.
## Rules for every subagent

- Worktree: `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/data-types-column-types-slice-1-6392eb`. Never read, write or run anything outside it. Working files go under `wip/` (gitignored), never `/tmp`.
- Run every `node`, `pnpm` and `git commit` through `mise exec --` (for example `mise exec -- pnpm typecheck:agent`). Save slow command output to a file under `wip/` once and read the file; do not rerun to grep different lines (`.agents/rules/running-tests.mdc`).
- Tests first, red before the change that makes them green. Test descriptions omit "should". Use arktype, not zod. Never `any`, never bare `as` in production code (`blindCast`/`castAs` from `@internal/utils/casts`), never `@ts-expect-error` outside negative type tests. No comments unless unavoidable. No backwards-compat shims or re-exports. No file extensions in imports.
- Commit with explicitly staged files (`git add <paths>`, never `git add -A`) and `mise exec -- git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>" -m "..."`. Do not add any AI attribution line (no Co-Authored-By Claude, no "Generated with Claude Code") anywhere: not in commits, not in files, not in pull requests. Never amend, squash, rebase, force-push or push. Never touch `main`.
- Markdown prose is never hard-wrapped: one paragraph or list item per line.
- Write reports in plain English, short sentences, no invented jargon, no bullet paragraphs. Report in under 350 words unless told otherwise.
- The design is the contract: `projects/data-types-completion/design.md`. Where it is silent on a choice you need, stop and report; do not choose.
- Never run the full `test:integration` or `test:e2e` suites locally; they are too heavy. Run a chosen subset (the golden planner test, `test/integration/test/authoring/`, and files the diff touches) and let CI run the rest.
