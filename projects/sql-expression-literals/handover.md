# Handover: SQL expression literals, 2026-09-30

You take over the project in this folder from an agent whose session hit a usage limit. Read this file, then [status.md](status.md), then the parts of [plan.md](plan.md) and [design.md](design.md) the next slice needs.

## Where things stand

- Branch `tml-3296-sql-expression-data-type` holds slice 2a (Linear TML-3296): `sql` is the tag of the data type `sql/expression`, which the SQL family defines and registers. The branch also holds every file in this folder.
- The branch is pushed to the `bot` remote. No pull request exists yet.
- Slice 2a was implemented, reviewed by an architect reviewer and a code reviewer, and every finding (A01 to A14, F01 to F09) is fixed. The reports are in [slice-reviews/2a/](slice-reviews/2a/). The decisions on each finding are in [dispatches/2a-review-fixes-brief.md](dispatches/2a-review-fixes-brief.md).
- The branch is based on `main` at `18e3711cbb`. `main` has moved since.

## What to do next, in order

1. Create a fresh worktree on `tml-3296-sql-expression-data-type`, run `pnpm install` and `pnpm build`.
2. Merge `origin/main` into the branch (a merge commit; never rebase). Resolve conflicts.
3. Run the commands in plan.md "Done conditions for every slice" after the merge. Do not run `pnpm test:integration` in full; run the integration files the slice touches alone and leave the full suite to CI. Save each output under `wip/` once and read the file.
4. Run `/drive-code-review` without the walkthrough on the commits after `f768a4e831` (the review fixes). The first review covered the commits before that. Write the reports to `slice-reviews/2a-round-2/` (the `reviews/` folder is gitignored). Fix what it finds.
5. Push, open the pull request for TML-3296 with the `create-pr` skill, and turn on the CI monitor. The title is "TML-3296: <sentence>", with no conventional-commit prefix.
6. Update status.md.
7. Start slice 2t (TML-3367). Another Linear project, "Data types own column types", is blocked until it merges. Its section in plan.md lists what it carries over from the slice 2a review.

## Things that will surprise you

- **Tarball tests fail locally.** The publish-shell and packaging tarball tests fail on Will's machine because `pnpm install` refuses `@vercel/detect-agent@1.2.5` as a "high-risk trust downgrade". It is the registry, not the branch. CI must show them green.
- **Flaky tests.** These failed once and passed on rerun: the Postgres render round-trip, two CLI tests, the language server's `completion-provider.test.ts`, the telemetry e2e test, and the relation-mode port test.
- **`contract infer` does not see family data types.** Its default mapping builds from the target's own lists. That is existing behaviour and out of scope; see [dispatches/2a-review-fixes-findings.md](dispatches/2a-review-fixes-findings.md).
- **Fable usage limit.** Will's rule is Fable for implementer subagents and Opus for reviewers. Fable ran out twice in this session; the last implementer ran on Opus.

## Rules Will set for this project

These are also in status.md. The most important:

- Design with Will, then execute without interrupting him. Make engineering decisions yourself. Go back to Will only when new information makes the design wrong.
- Every slice gets `/drive-code-review` (no walkthrough), then fixes, then manual QA, before its pull request.
- Commits: `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`, no AI attribution lines, never amend, squash, rebase or force-push. Push through the `bot` remote.
- No temp directories: scratch files go in the gitignored `wip/`.
- Write to Will in plain English, briefly.

## Context from the previous session

The transcript of the session that planned and started this project is on Will's machine at:

`/Users/wmadden/.claude/projects/-Users-wmadden-Projects-prisma-orm--claude-worktrees-index-where-check-rls-5be8b6/3a5b5af0-5cc1-4d56-8be1-c8709196bb41.jsonl`

It is a large JSONL file. Do not read it whole. Search it for a topic, for example with `grep -n "A01"` or `grep -n "dataTypeValue"`, and read the lines around each match. The decisions it contains are already recorded in design-notes.md, status.md and this file; read the transcript only when those do not answer a question.

The session in the Claude desktop app is `claude://claude.ai/epitaxy/local_8d92a7fd-7cce-4b23-9fb7-26503c53eb9b`.
