# Handover: SQL expression literals (TML-3282), 2026-10-08

You take over this project from the agent hammurabi-31. This file supersedes every earlier handover. Read it, then [status.md](status.md) (its "State on 2026-10-07" section and "Slice 2b review, round 3"), then the parts of [plan.md](plan.md), [design.md](design.md) and [design-notes.md](design-notes.md) your next step needs. Before acting on any project or architecture detail, read the architecture docs and the ADRs this project depends on (129, 231, 234, 243, 244, 254, 262, 268); Will insists on it.

## Where to work

Create a fresh worktree from the `bot` remote (`git@github-wmadden-electric:prisma/orm.git`), branch `tml-3288-sql-expression-places` while #30550 is open, or `main` once it has merged. Run `mise exec -- pnpm install`, `mise exec -- pnpm build`, then `mise exec -- pnpm install` again (a fresh worktree needs the second install to link the published shells). Everything is pushed; nothing is uncommitted. The previous worktree used the local branch name `h31-2b`; ignore it. If git refuses a branch because another worktree has it, use a different local name and push with `git push bot <local>:<remote-branch>`.

## State of the pull requests

| Slice | Ticket | PR | State |
| --- | --- | --- | --- |
| 2a, 1, 4, 2t | TML-3296, TML-3287, TML-3290, TML-3367 | #30534, #30546, #30554, #30539 | Merged. 2t shipped in rc.16. |
| 2b | TML-3288 | [#30550](https://github.com/prisma/orm/pull/30550) | **Approved by Will ("merge at will").** Auto-merge on. Head `e787f95b5d` was pushed on 2026-10-08 after merging `main` at `1923c35787` (rc.17). Waiting for PR CI, then it enters the merge queue by itself. |
| 3 | TML-3289 | [#30558](https://github.com/prisma/orm/pull/30558) | Based on the 2b branch, in conflict with it. Waits for 2b. |
| 5 (stretch) | TML-3297 | | Not started. Ask Will first. |

## What to do first: land #30550

1. Check its state: `gh api graphql -f query='{repository(owner:"prisma",name:"orm"){pullRequest(number:30550){state reviewDecision mergeable autoMergeRequest{enabledAt} mergeQueueEntry{state position}}}}'`.
2. Bind it to your session's CI monitor (`mcp__ccd_pr__bind_pr`, then `mcp__ccd_pr__set_monitor` with `auto_fix: true`). Binding replays the PR's whole comment history as "new"; every thread is resolved, so check `reviewThreads` with `isResolved == false` before acting on any comment.
3. **Watch the merge queue yourself.** The app does not report a queue ejection; Will had to tell the last agent, and was angry. Start one background Bash loop that polls the PR every 60 s and exits when `state` is `MERGED`, or when it is `OPEN` with auto-merge off and no queue entry (ejected). On an ejection, find the run with `gh run list --repo prisma/orm --event merge_group --json databaseId,headBranch,conclusion,name` (head branch contains `30550`) and read `gh run view <id> --log-failed` at once.
4. Why it was ejected twice on 2026-10-08:
   - First: semantic clashes with newer `main` (planner inputs `origin` and `statements` became required in TML-3476; `main`'s new journey fixtures wrote raw SQL as quoted strings). Fixed.
   - Second: a known flake, not this branch. The Postgres driver's test worker crashed in V8 (`Worker exited unexpectedly with signal SIGILL` in `packages/3-targets/7-drivers/postgres/test/driver.json-text.integration.test.ts`, after `Check failed: jit_page_->allocations_.erase(addr) == 1`). If that recurs, tell Will and ask before requeueing; never re-run CI jobs without his go-ahead.
5. When `main` moves and the PR conflicts: `git fetch origin main`, merge it (never rebase or force-push), keep `main`'s structure and this project's syntax (raw SQL places receive `sql/expression` through `dataTypeValue`; fixtures and docs write `sql` literals; printers use `printSqlExpressionLiteral` after the read-back check). After every merge run `git diff --name-only origin/main -- upgrade-instructions/releases skills/prisma-8/upgrading`; it must be empty (released fragments are never edited). Sweep new `.prisma` files with the codemod (`node scripts/codemods/rewrite-sql-strings.mjs <paths>`) and new inline PSL by hand. Run root `pnpm typecheck`, `pnpm fixtures:check`, `pnpm lint:deps`, and the touched test files alone. Push, then re-enable auto-merge (`gh pr merge 30550 --repo prisma/orm --auto`), since an ejection turns it off. Will's approval survives pushes.
6. After it merges: set TML-3288 to Done in Linear with a closing comment (the integration may leave it In Progress), and tell Will.

## Then: slice 3 (#30558)

Retarget to `main`, merge `main` (where `main`'s file equals the 2b tip, slice 3's side wins), and run the released-fragment check. Its branch still names the ADR file `ADR 260 - Raw SQL is a value of the data type sql-expression.md`; the decision is **ADR 268** now (ADR 267 belongs to #30641), so rename it and every reference. Then a review round on what changed since its round 2 (two Opus reviewers: architect and principal-engineer personas from `~/.claude/skills/drive-process/references/agent-personas.md`), fixes by an Opus implementer, a fixes check, manual QA, then Will. Its carry-overs are in plan.md, slice 3.

## Close-out (after slice 3)

plan.md "Close-out": map each decision in design-notes.md to ADR 268 or an amended ADR, delete `projects/sql-expression-literals/`, mark the Linear project complete, tell Will.

## What the last session did (2026-10-07 to 08)

- Merged `main` three times; renumbered the ADR from 267 to 268.
- Review round 3 of 2b (C01 to C08, D01 to D10), all fixed or answered; reports and fixes check in `slice-reviews/2b-round-3/`. Highlights: ADR 268 had said line comments rename objects (slice 1 built that rule; canonicalization renames nothing); the extension fragment described a `BlockSpecContext.block` field that does not exist; block value completion now has tests and offers `sql` at a policy's `using` (integration test `test/integration/test/authoring/lsp-sql-completion-in-blocks.integration.test.ts`).
- The CLI journey `sql-expression-literals.e2e.test.ts` now has texts ending in `--` comments (slice 1 could not add them, since the file did not exist then).
- Manual QA of slice 2b rerun on 2026-10-07: all 38 cases match.
- The PR description was rewritten (base `main`, ADR 268, current messages).
- Kept on purpose: the Bash hook change in `.claude/scripts/enforce-tools.mjs` (Will asked for it); the PR description names it as unrelated.

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

This session's transcript (hammurabi-31, 2026-10-07 to 08):

`/Users/will/.claude/projects/-Users-will-Projects-prisma-orm--claude-worktrees-sql-expression-literals-handover-c716de/ede553f9-49a2-4dd1-a029-1816ec60bdc3.jsonl`

Earlier sessions:

- marconi-29: `/Users/wmadden/.claude/projects/-Users-wmadden-Projects-prisma-orm--claude-worktrees-sql-expression-literals-handover-3c78f4/ea08b13e-c168-4c0e-a372-06c63f31c561.jsonl`
- charon-96: `/Users/wmadden/.claude/projects/-Users-wmadden-Projects-prisma-orm--claude-worktrees-sql-expression-literals-e3d9e9/f34c3092-a059-4002-8e3e-116ce266d1ac.jsonl` and `/Users/wmadden/.claude/projects/-Users-wmadden-Projects-prisma-orm--claude-worktrees-index-where-check-rls-5be8b6/3a5b5af0-5cc1-4d56-8be1-c8709196bb41.jsonl`

They are large JSONL files, readable from this account. Do not read them whole; grep for a topic and read the lines around each match. Will's own messages are `type == "user"` entries that are not `isMeta` and do not start with `<task-notification`, `<system-reminder` or `<command-`.
