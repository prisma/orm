# Journey 06 — Feedback skill: bug report

**Skill under test:** `prisma-next-feedback`.

**Acceptance criterion:** AC8c (bug report path) from `specs/usage-skill.spec.md`.

## Setup

A `prisma orm init`-scaffolded project (any target).

## Prompt

> I want to report that `prisma migration plan` exits 0 even when the planner found no diff — that's surprising

## Expected agent behaviour

- [ ] Skill matcher fires on `prisma-next-feedback`.
- [ ] Agent classifies as a **bug report** (the CLI exit code is arguably wrong vs. documented behaviour). Not a feature request.
- [ ] Agent produces a minimal reproduction:
  - A small `schema.psl` excerpt (renamed to neutral domain names like `User`, `Post`).
  - The exact command (`prisma migration plan --name no-op`) and its full output.
  - A numbered list of steps to reproduce.
- [ ] Agent collects the environment block:
  - Prisma Next version (from `pnpm ls @internal/postgres` or similar).
  - Node version (`node -v`).
  - Package manager + version.
  - OS.
- [ ] Agent renders the issue body using the bug-report fields from `.github/ISSUE_TEMPLATE/bug_report.yml`: *Package and version / What happened? / What did you expect to happen? / Minimal reproduction / Environment / Additional context*.
- [ ] Agent renders a conventional-commit title: `bug(cli): migration plan exits 0 when there is no diff`.
- [ ] Agent surfaces the rendered title + body to the user for confirmation **before** submitting.
- [ ] On user confirmation, agent submits via `gh issue create` (preferred) or opens the prefilled new-issue URL in the browser.
- [ ] Agent records the issue URL in the user's project notes.

## Success criteria

- [ ] No `DATABASE_URL` strings or secrets in the body.
- [ ] No customer-domain model names in the body.
- [ ] Body contains all required fields named in the bug-report issue form (`Package and version`, `What happened?`, `What did you expect to happen?`, `Minimal reproduction`, `Environment`).
- [ ] Title is in conventional-commit form.
- [ ] User was prompted for confirmation before submission.
- [ ] Issue submitted to `prisma/prisma` (verified by URL in the agent's response).
