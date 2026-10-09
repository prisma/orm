# Handover: SQL expression literals (TML-3282), 2026-10-08

lagertha-65 holds the project. This file supersedes every earlier handover. Read it, then [status.md](status.md) ("State on 2026-10-08"), then the parts of [plan.md](plan.md), [design.md](design.md) and [design-notes.md](design-notes.md) your next step needs. Before acting, read the architecture docs and the ADRs this project depends on (129, 195, 231, 234, 243, 244, 249, 254, 262, 268); Will insists on it.

## Where things stand

- Slices 2a, 2t, 1, 4 and 2b are merged. 2b merged on 2026-10-08 as #30550.
- Slice 3 (TML-3289, #30558, branch `tml-3289-sql-expression-ts`) is merged up to `main` and names its ADR 268. Next: review round 3 with `/drive-code-review` (two Opus reviewers), fixes, manual QA, then Will.
- Slice 5 (TML-3297) is confirmed by Will. Start it only after slice 3 is with Will; never run two slices at once. Its design is section 17 of design.md, limited to the places section 17.1 names (planner-built SQL such as the SQLite rebuild postcheck stays a string). It must update the Migration System doc ("the contract-free factories still take strings") and record the exception in ADR 195.
- Close-out after the last slice: plan.md "Close-out". design-notes.md decision 4 is out of date (the family registers `sql/expression` itself); map decisions from what shipped.

## Rules Will set (also in the global CLAUDE.md and memory)

- Design with Will, then execute without interrupting him. Make engineering decisions yourself and state them.
- Every subagent runs on Opus (`model: "opus"`), never Fable. Docs (ADRs, specs, plans, PR text, status) are written by the orchestrator, not delegated.
- **Never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all` locally.** Run the files a change touches; integration files with `mise exec -- pnpm --filter integration-tests test <path>` (no `--` before the path). Put this in every brief.
- Commits: `mise exec -- git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`, no AI attribution lines, never amend, squash, rebase or force-push. Push through the `bot` remote. Run node and pnpm through `mise exec --`. Update PR bodies with `gh api -X PATCH repos/prisma/orm/pulls/<n> -F body=@file` (`gh pr edit` fails under the bot token).
- PR titles "TML-NNNN: sentence". Descriptions open with what a user sees, then the decision, then the build-up, alternatives last, `Agent: <your name>` before the attribution line.
- Bot review comments: fix what is right, reply ending with `_🤖 Addressed by [Claude Code](https://claude.com/claude-code)_`, resolve the thread.
- Write to Will in plain English, short sentences. Explain every mechanism you mention from scratch; he does not read briefs or tickets. No question UI, no task chips.
- The three tarball tests fail locally on a registry refusal (`@vercel/detect-agent` trust downgrade); CI checks them.

## Context from earlier sessions

lagertha-65 (2026-10-08): `/Users/wmadden/.claude/projects/-Users-wmadden-Projects-prisma-orm--claude-worktrees-sql-expression-literals-handover-da9f0f/095a0298-1adb-4af0-87f3-f80ae38d93c7.jsonl`

This session's transcript (hammurabi-31, 2026-10-07 to 08):

`/Users/will/.claude/projects/-Users-will-Projects-prisma-orm--claude-worktrees-sql-expression-literals-handover-c716de/ede553f9-49a2-4dd1-a029-1816ec60bdc3.jsonl`

Earlier sessions:

- marconi-29: `/Users/wmadden/.claude/projects/-Users-wmadden-Projects-prisma-orm--claude-worktrees-sql-expression-literals-handover-3c78f4/ea08b13e-c168-4c0e-a372-06c63f31c561.jsonl`
- charon-96: `/Users/wmadden/.claude/projects/-Users-wmadden-Projects-prisma-orm--claude-worktrees-sql-expression-literals-e3d9e9/f34c3092-a059-4002-8e3e-116ce266d1ac.jsonl` and `/Users/wmadden/.claude/projects/-Users-wmadden-Projects-prisma-orm--claude-worktrees-index-where-check-rls-5be8b6/3a5b5af0-5cc1-4d56-8be1-c8709196bb41.jsonl`

They are large JSONL files, readable from this account. Do not read them whole; grep for a topic and read the lines around each match. Will's own messages are `type == "user"` entries that are not `isMeta` and do not start with `<task-notification`, `<system-reminder` or `<command-`.
