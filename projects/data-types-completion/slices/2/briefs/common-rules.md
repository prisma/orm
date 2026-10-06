## Rules for every subagent

- Worktree: `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/data-types-column-types-slice-1-6392eb`. Never read, write or run anything outside it. Working files go under `wip/` (gitignored), never `/tmp`.
- Run every `node`, `pnpm` and `git commit` through `mise exec --` (for example `mise exec -- pnpm typecheck:agent`). Save slow command output to a file under `wip/` once and read the file; do not rerun to grep different lines (`.agents/rules/running-tests.mdc`).
- Tests first, red before the change that makes them green. Test descriptions omit "should". Use arktype, not zod. Never `any`, never bare `as` in production code (`blindCast`/`castAs` from `@internal/utils/casts`), never `@ts-expect-error` outside negative type tests. No comments unless unavoidable. No backwards-compat shims or re-exports. No file extensions in imports.
- Commit with explicitly staged files (`git add <paths>`, never `git add -A`) and `mise exec -- git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>" -m "..."`. Do not add any AI attribution line (no Co-Authored-By Claude, no "Generated with Claude Code") anywhere: not in commits, not in files, not in pull requests. Never amend, squash, rebase, force-push or push. Never touch `main`.
- Markdown prose is never hard-wrapped: one paragraph or list item per line.
- Write reports in plain English, short sentences, no invented jargon, no bullet paragraphs. Report in under 350 words unless told otherwise.
- The design is the contract: `projects/data-types-completion/design.md`. Where it is silent on a choice you need, stop and report; do not choose.
- Never run the full `test:integration` or `test:e2e` suites locally; they are too heavy. Run a chosen subset (the golden planner test, `test/integration/test/authoring/`, and files the diff touches) and let CI run the rest.
