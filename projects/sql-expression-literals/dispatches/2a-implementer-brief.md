# Brief: implement slice 2a (TML-3296)

You implement slice 2a of the project in `projects/sql-expression-literals/`. You work in the git worktree at the current directory, on branch `tml-3296-sql-expression-data-type`. Do not read, write or run anything outside this worktree. Do not use `/tmp` or any temp directory; use the gitignored `wip/` folder for scratch files.

## Read first, in this order

1. `CLAUDE.md` at the worktree root, and `.agents/rules/README.md`.
2. `projects/sql-expression-literals/status.md`.
3. `projects/sql-expression-literals/plan.md`: "Done conditions for every slice" and "Slice 2a".
4. `projects/sql-expression-literals/design.md`: sections 1, 2 (the slice 2a parts), 3, 10, 10.1, 11.1, 13 (the `@default` rows), 18.2, 18.3 (slice 2a items), 19 (slice 2a rows), 20 (slice 2a row).
5. `projects/sql-expression-literals/research/data-types.md` and `research/rebase-delta.md` when you need the facts behind a design statement.

## Step 1: re-check the design against the code

The design was written against an older commit. Before you change code, check every file, function and line the slice 2a sections name against the current code.

- A file, line or function that moved or was renamed: correct the design text and continue. Commit the corrections.
- A difference in behaviour, or in a type the design depends on: stop. Write what you found to `projects/sql-expression-literals/dispatches/2a-findings.md` and report it. Do not decide it yourself.

## Step 2: implement

- Follow the design exactly. You have no design freedom: every name, signature, message and file is fixed. If the design is silent or wrong, stop and report as in step 1.
- Write or update the tests before the implementation. The plan lists the tests.
- Do not implement anything from slices 1, 2t, 2b, 3, 4 or 5.
- Repository rules: `pnpm` only, never `npx`; no `any`; no bare `as` in production code; no file extensions in imports; no comments unless the code cannot say it; no re-exports outside `exports/`; test names omit "should".
- Record the upgrade instructions the design's section 20 names for slice 2a, following `skills-contrib/record-upgrade-instructions/SKILL.md`.
- Add the slice's manual QA script to `projects/sql-expression-literals/manual-qa.md` and record a run.

## Step 3: verify

Run every command in the plan's "Done conditions for every slice". Save each command's output to a file under `wip/` once and read the file; do not re-run a command to look at different lines. Run `pnpm lint:throws` and `pnpm check:upgrade-coverage` locally, because the agent lint skips them. The tip of the branch must be green.

## Commits

- Commit in small steps with explicit `git add <paths>`, never `git add -A`.
- Commit with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`.
- Put no AI attribution in any commit: no `Co-Authored-By` line and no "Generated with" line.
- Never amend, squash, rebase or force-push. Do not push. Do not open a pull request.

## When you finish or stop

Update the "State" section and the table in `projects/sql-expression-literals/status.md`, commit it, and report:

1. What you changed, in a few sentences.
2. Every correction you made to the design.
3. The result of each verification command, with the path of its output file. Report failures as failures.
4. Anything you could not do, and why.
