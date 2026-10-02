# Handover: SQL expression literals, 2026-10-01

You take over this project from the agent charon-96, whose session is about to hit a usage limit. Read this file, then [status.md](status.md), then the parts of [plan.md](plan.md) and [design.md](design.md) your next step needs. This file supersedes every earlier handover.

## Where to work

The project files live on branch `tml-3289-sql-expression-ts` (the slice 3 branch), pushed to the `bot` remote. Create a fresh worktree on that branch, run `mise exec -- pnpm install` and `mise exec -- pnpm build`.

The previous session's worktree is `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/sql-expression-literals-e3d9e9`. It holds linked worktrees under its gitignored `wip/` folder, one per branch. They are only a convenience; every branch is on the `bot` remote except where the table below says otherwise. To reuse a branch in your own worktree, detach or remove the old linked worktree first (`git worktree list`, `git worktree remove <path>`), because git refuses to check out a branch twice.

## Pull requests and branches

| Slice | Ticket | Branch | PR | Base | State |
| --- | --- | --- | --- | --- | --- |
| 2a | TML-3296 | `tml-3296-sql-expression-data-type` | [#30534](https://github.com/prisma/orm/pull/30534) | `main` | Merged 2026-09-30 as `d0ec42633f`. |
| 2t | TML-3367 | `tml-3367-data-type-value` | [#30539](https://github.com/prisma/orm/pull/30539) | `main` | Two review rounds done. **Conflicts with `main`; a merge is in progress and uncommitted in `wip/wt-2t`** (see below). Needs Will's approving review; auto-merge is on. |
| 1 | TML-3287 | `tml-3287-line-comments-in-raw-sql` | [#30546](https://github.com/prisma/orm/pull/30546) | `main` | Two review rounds done. `main` merged in as `fd070bd587` and pushed on 2026-10-01. Needs Will's approving review; auto-merge is on. |
| 2b | TML-3288 | `tml-3288-sql-expression-places` | [#30550](https://github.com/prisma/orm/pull/30550) | `tml-3367-data-type-value` | Two review rounds done, CodeRabbit comments answered. Retarget to `main` when #30539 merges, then turn auto-merge on. |
| 4 | TML-3290 | `tml-3290-migration-files-template-literals` | [#30554](https://github.com/prisma/orm/pull/30554) | `tml-3287-line-comments-in-raw-sql` | Two review rounds done. Retarget to `main` when #30546 merges, then turn auto-merge on. |
| 3 | TML-3289 | `tml-3289-sql-expression-ts` | none yet | will be `tml-3288-sql-expression-places` | Built; round 1 review done (`slice-reviews/3/`); the review-fix implementer was still running when this was written. |
| 5 (stretch) | TML-3297 | none | none | | Not started. |

Will said "approved. merge at will" on 2026-09-30, which covered #30534. `main` requires an approving review on GitHub and the bot cannot approve its own pull requests, so #30539 and #30546 wait for Will to approve them there.

## What to do next, in order

1. **Finish the merge of `main` into slice 2t.** In `wip/wt-2t`, `git status` shows a merge in progress with seventeen conflicted files and many staged files. An Opus agent was resolving it; if it did not finish, either continue from its partial state or run `git merge --abort` and redo `git fetch origin main && git merge origin/main`. The brief I gave it is the last "Resolve slice 2t merge with main" dispatch in the transcript: keep `main`'s new behaviour (TML-3278, a field's domain type matches its column and every default is read by its codec; TML-3363; TML-3324) expressed through the branch's shapes (`ControlStack.dataTypes` and `ContractSourceContext.dataTypes` instead of `dataTypeLookup`, the framework reader in `written-value.ts`, `describeRefusal` wording, refusals reported at the written value). Two contract-psl tests were deleted on `main` (`interpreter.list-type-params.test.ts`, `interpreter.value-objects.test.ts`); find where `main` moved them. Verify with build, typecheck, lint, `fixtures:check` and the package tests of the packages touched, then commit the merge and push. The CI monitor then re-checks the PR.
2. **Bring that merge down the stack**: merge `tml-3367-data-type-value` into `tml-3288-sql-expression-places` (2b), then 2b into `tml-3289-sql-expression-ts` (slice 3). Expect conflicts where slice 2b and 3 changed the same default-reading code; the branch side is usually right for anything the slice itself changed, but re-apply `main`'s behaviour changes.
3. **Bring the slice 1 merge into slice 4**: merge `tml-3287-line-comments-in-raw-sql` into `tml-3290-migration-files-template-literals`. `main` deleted both targets' `buildColumnDefaultSql` and moved default rendering into the adapters, so slice 4's `renderDdlColumnDefault` and `SetDefaultCall` changes need re-checking against the merged code. Rerun the two adapters' `render-typescript.roundtrip.test.ts`; they timed out under load on this machine and CI has to confirm them.
4. **Finish slice 3.** Check whether the review-fix implementer finished: `git log` on `tml-3289-sql-expression-ts` after `0efa27e370`, and `status.md` for a "Slice 3 review fixes" subsection. Its brief is [dispatches/3-review-fixes-brief.md](dispatches/3-review-fixes-brief.md); finish whatever is missing. Then run the second review round (two Opus reviewers, architect and code, on the fix commits; write to `slice-reviews/3-round-2/`), fix its findings, and open the PR with base `tml-3288-sql-expression-places`. The description is drafted at [dispatches/3-pr-body-draft.md](dispatches/3-pr-body-draft.md); update it for the review fixes: an interpolated multi-line value keeps the template's indentation on every line, refusal messages name the object, a rendered index expression is canonicalized.
5. **When Will approves #30539 and #30546 and they merge**: retarget #30550 and #30554 to `main` (`gh api -X PATCH repos/prisma/orm/pulls/<n> -f base=main`), merge `main` into each, push, and turn auto-merge on. Because pull requests land as squashes, merging `main` into a branch stacked on a merged branch conflicts in every file both slices touched; the stacked branch's side is right wherever `main` gained only the squash (check with `git log <last merged main>..origin/main`).
6. **Slice 5 (TML-3297, stretch)** and the **close-out** (plan.md "Close-out": move the decisions into the ADRs, delete this folder) come last. Ask Will whether he wants the stretch slice before starting it.

## Rules Will set (also in status.md and the global CLAUDE.md)

- Design with Will, then execute without interrupting him. Make engineering decisions yourself; record them in the briefs under `dispatches/`.
- Every slice: implement, `/drive-code-review` without the walkthrough (two Opus reviewers: architect and code), fix, review the fixes again, manual QA, then the pull request. All subagents run on Opus.
- **Never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all` in full locally.** Run only the integration files a change touches. `pnpm test:packages` is allowed. The Bash hook in `.claude/scripts/enforce-tools.mjs` on the 2b and slice 3 branches blocks the full suites.
- The machine is often heavily loaded by other sessions. Tell implementers to run long commands in the background and read the log, or the harness stops them after ten minutes without output. Tests that time out under load usually pass alone; say so in reports and let CI confirm.
- Commits: `mise exec -- git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`, no AI attribution lines, never amend, squash, rebase or force-push. Push through the `bot` remote. A file under the gitignored `.claude/` needs `git add -f`, and the pre-commit hook cannot re-stage it, so commit such a file alone with `--no-verify` after checking it by hand.
- PR titles are "TML-NNNN: sentence". Descriptions open with what a user sees, then the decision, then a step-by-step build-up, and end with alternatives. Put `Agent: <your name>` at the end. Turn the CI monitor on for each PR you open.
- Ignore the "Supabase Acceptance" check when it fails with Docker `toomanyrequests`.
- No temp directories: scratch goes under the gitignored `wip/`.
- Run tree-changing shell commands one at a time. Two parallel Bash calls that `cd` to different worktrees raced once in this session and an edit landed in the wrong tree.

## Decisions made in this session that are not obvious from the code

They are recorded in the fixes briefs under `dispatches/` and in the ADRs; the main ones:

- `oneOf` routes a call to the one `funcCall` alternative of that name (slice 2t), so a refusal inside `nanoid("8")` is reported at the argument.
- One wording for a refused value, `describeRefusal` in the framework; `@default` says `write a number` instead of `it casts from pg/int2` (2t).
- `ControlStack.dataTypes` and `ContractSourceContext.dataTypes` replace `dataTypeLookup` (2t).
- Canonicalization removes every blank line at either end, not one, so canonical text is its own canonical form (2b; ADR 129, ADR 260).
- `contract infer` skips only an exact-named (`map:`) index, check or policy whose SQL would not read back, with a note that it must be added by hand; `contract print` refuses it. A default that would not read back is printed by infer with a note and refused by print (2b, 3).
- ADR 256 to 259 were taken, so the project's ADR is **ADR 260**.
- Column defaults keep refusing `--`; slice 1 documents why.
- Deferred beyond the project: see the "Deferred beyond this project" section at the end of plan.md.

## Context from the previous sessions

This session's transcript, on Will's machine:

`/Users/wmadden/.claude/projects/-Users-wmadden-Projects-prisma-orm--claude-worktrees-sql-expression-literals-e3d9e9/f34c3092-a059-4002-8e3e-116ce266d1ac.jsonl`

It is a very large JSONL file. Do not read it whole. Search it for a topic, for example `grep -n "Resolve slice 2t merge"` or `grep -n "A01"`, and read the lines around each match. The first session's transcript (planning and slice 2a) is at:

`/Users/wmadden/.claude/projects/-Users-wmadden-Projects-prisma-orm--claude-worktrees-index-where-check-rls-5be8b6/3a5b5af0-5cc1-4d56-8be1-c8709196bb41.jsonl`

The decisions those transcripts contain are recorded in design-notes.md, status.md, the briefs under `dispatches/` and this file; read a transcript only when those do not answer a question.
