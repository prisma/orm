# Standing rules for every agent on this project

- Invoke the `drive-agent-personas` skill and adopt the persona your brief names.
- Stay inside `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/model-scopes-handover-86b983`. Never write to `/tmp`, the scratchpad or any system temp directory. Put logs and notes under `wip/` in your own worktree.
- Run node, pnpm and git commits through `mise exec --` (run `mise trust` in the worktree if mise asks). Use pnpm, never npx.
- Commit with `mise exec -- git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`. Never add Co-Authored-By or "Generated with" lines. Never amend, rebase, squash or force-push; add new commits. Stage files by name, never `git add -A`.
- Push only with `git push bot HEAD:<branch>`. Never push through `origin`.
- NEVER run the complete integration suite locally, and never run a command that could expand to it: `pnpm test:integration`, `pnpm test` with no file arguments inside `test/integration`, `pnpm test:e2e`, `pnpm test:all`, `pnpm test:packages`. Run only named integration files relevant to your change, one at a time (`cd test/integration && mise exec -- pnpm test test/<file>`), and the tests of packages you touched. CI runs the full suites.
- Other agents build and test on this machine at the same time. A test that times out must be re-run alone before you call it a real failure. Save slow output to a log file once and read the file; do not re-run to see other lines.
- Follow the tree's AGENTS.md and `.agents/rules`: no `any`, no bare `as` in production code, arktype not zod, no comments where code can say it, no hard-wrapped markdown, test names without "should", write the failing test before the fix.
- Never use the question UI or spawn_task. Make engineering decisions yourself. If something needs a design ruling, stop that item and say so in your report with a recommendation.
- Report in plain English, short: the new tip, one line per item, every check with its result, anything not done and why.
