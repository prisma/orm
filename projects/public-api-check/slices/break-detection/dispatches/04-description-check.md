# Dispatch 4: the pull request description names each API change, and a comment lists them

Issued 2026-11-25 to the implementer (Opus, medium effort). Slice spec: [../spec.md](../spec.md), section "Description check and comment". Project spec: [../../../spec.md](../../../spec.md), section "Human oversight".

The design is strong guidance and our best effort, not a fixed spec. Check it against the code as you go. Where you find it wrong, incomplete or worse than an alternative, say so with evidence; do not build what you believe is wrong, and do not depart from it silently.

## Outcome

When a pull request changes any `packages/9-public/@prisma/*/api.txt`, a workflow:

- posts one comment listing, per package, the `api.txt` lines the pull request adds and removes, and edits that comment on later runs instead of posting another; on a pull request from a fork, where the token cannot comment, it writes the same text to the job summary;
- fails until the description has a section headed `## API changes` that names each changed export, with text after the names saying why.

A pull request that changes no `api.txt` passes and gets no comment. In the merge queue the job passes, because a merge-queue event carries no description.

## Requirements

- New workflow `.github/workflows/api-changes.yml`, on `pull_request` with types `opened`, `edited`, `synchronize`, `reopened`, and on `merge_group`. `pull-requests: write` on the job only; `contents: read` otherwise. Never `pull_request_target`. Follow `bundle-size.yml` for shape (pinned action SHAs with version comments, `persist-credentials: false`) and pass the repository's workflow lints (`scripts/lint-workflow-triggers.mjs` and any other that reads workflows).
- The logic is a script in `.github/workflows/scripts/` (for example `api-changes.mjs`), with its tests beside it (`api-changes.test.mjs`, run with `node --test`). The workflow stays a few lines that call it.
- The unit a reviewer names is an export: a line's import path and name, or, for a `(not exported)` line, its name. A changed line counts once for its export. Members count for the export they belong to. Decide how the section must write a name (for example in backticks, with or without the path) so that it is easy to write and unambiguous, and print the exact names a missing section must contain in the failure message.
- The diff is between the pull request's base and head, read with git, not the API.
- The comment is found again by a hidden marker in its body. It is long-diff safe: when the text is too long for a comment, it is cut with a line saying how many lines were left out and that the full list is in the job summary.

## Tests (write them first; each must be able to fail)

Parsing added and removed lines into exports; a description that names all of them passes; one missing name fails and the message lists it; a section with names but no reason fails; no `api.txt` change passes; the comment body for a short and an over-long diff; the fork case writes the summary and does not call the comment API.

## Constraints

- Work only in this worktree. Every scratch file under `wip/`. No system temp folders.
- Edit only `.github/workflows/api-changes.yml` and files under `.github/workflows/scripts/` whose names start with `api-changes`. Do not edit `package.json`; say in your report which test file the orchestrator should add to `test:scripts`. Another implementer is changing `scripts/public-api/`, `package.json` and `ci.yml` at the same time.
- Never run a whole test suite. Run only your own test files, plus the workflow lints.
- Hard time limits on long commands (`perl -e 'alarm N; exec @ARGV' …`). Kill only PIDs you started.
- Stage only your own files by path; if `git` reports `index.lock`, wait and retry. Commit small, intent-named commits with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`, ending each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push. No destructive git operations.
- `pnpm` only. Comments only where code cannot say it.

## Report

Return: what you built, file by file; test results; the name format you chose and why; an example comment and an example failure message; where you departed from this brief and why; what you did not verify.
