---
name: contrib-pr
description: Open a high-quality external contributor PR against prisma/prisma. Use when the user is an outside contributor (not a Prisma maintainer) and wants to submit a change as a pull request from a fork. Encodes the contribution flow from CONTRIBUTING.md so the resulting PR passes review on the first round.
---

# Contributor PR skill (external)

This skill is for **external contributors** to `prisma/prisma` who are using an LLM-based agent to author or finalize a PR. It is intentionally separate from the maintainer-facing `create-pr` skill: it does not depend on Linear access, internal plan/spec documents, or any private context. It encodes the expectations laid out in [`CONTRIBUTING.md`](../../CONTRIBUTING.md) as a runnable workflow, so the PR you produce matches the shape maintainers expect on the first review round.

If the user is a maintainer with access to internal Linear tickets, use `create-pr` instead.

## When to use

Trigger this skill when the user says any of:

- "Open a PR for this contribution"
- "Submit this as a PR to prisma-next"
- "I'm contributing to prisma-next, finalize my change"
- "Help me get this PR ready for review"

If the user has clearly already followed the contribution flow and just needs the `gh pr create` invocation, you may skip directly to step 5.

## Operating principle

Verify the **result**, not the authorship. The maintainers do not ask whether the change was AI-assisted; they verify that:

1. It is scoped to one logical concern.
2. The right test suite is green.
3. The PR explains *why* the change exists, not file-by-file *what*.
4. Every commit is signed off (DCO).
5. The PR title is in conventional-commit form.

This skill is a pit of success — there is no CI gate that checks you used it. Following it is the cheapest way to land the PR cleanly.

## Workflow

### Step 1 — Read the contribution contract

Before doing anything else, read the project's contribution docs:

1. Read [`CONTRIBUTING.md`](../../CONTRIBUTING.md). This is the source of truth for setup, the test command set, DCO signoff, and PR expectations.
2. Read [`CODE_OF_CONDUCT.md`](../../CODE_OF_CONDUCT.md) so you understand what's expected in your interactions on the PR thread.
3. Skim [`SECURITY.md`](../../SECURITY.md). If your change is fixing a security issue, **stop and use the Private Vulnerability Reporting flow instead** — do not open a public PR.

If anything in `CONTRIBUTING.md` contradicts what this skill says, `CONTRIBUTING.md` wins.

### Step 2 — Confirm the change is in the right shape

Before opening the PR, check:

- **One logical change.** If the diff includes unrelated cleanup or "while I was here" fixes, ask the user whether to split them into separate PRs. Mixed-scope PRs almost always trigger a "please split this" review comment.
- **Substantive change?** If the change is more than a typo / doc fix / obvious bug fix, ask the user whether they opened a tracking issue first per `CONTRIBUTING.md`. If not, recommend they do — maintainers will respond within 5 business days, and a half-day issue conversation can prevent a one-week PR rewrite when the design direction differs from what they expect.
- **Tests updated.** If the change has any behavioural delta and there are no test changes in the diff, push back on the user before opening the PR. "Why aren't there tests?" is the most common reason a PR gets bounced.
- **No backward-compat shims.** prisma-next is pre-1.0; if the change renames or removes an API, the call sites should be updated, not aliased.

### Step 3 — Run the right test suites

Run the suite that matches the scope of the change. From `CONTRIBUTING.md`:

| Change scope                       | Command                              |
| ---------------------------------- | ------------------------------------ |
| Type errors only                   | `pnpm typecheck`                     |
| Lint / formatting                  | `pnpm lint`                          |
| Unit tests in `packages/**`        | `pnpm test:packages`                 |
| Examples                           | `pnpm test:examples`                 |
| Postgres / SQLite e2e              | `pnpm test:e2e`                      |
| Database integration               | `pnpm test:integration`              |
| Vite plugin / Cloudflare Worker    | `pnpm test:vite-plugin` *(needs Docker)* |
| Everything                         | `pnpm test:all`                      |

The minimum bar before opening any PR is:

```bash
pnpm typecheck && pnpm lint && pnpm test:packages
```

If any of these fail, fix the failure (or push back on the user about whether the change is actually right) before continuing. **Do not open a PR with a known-failing test or lint error.** It will be closed for that reason alone.

If the change touches the SQL runtime, also run `pnpm test:integration` and/or `pnpm test:e2e`. If you can't tell whether the change touches the SQL runtime, run them anyway — they're self-contained (PGlite + mongodb-memory-server, no external DB needed).

### Step 4 — Sign off the commits (DCO)

Every commit on the PR must have a `Signed-off-by:` trailer matching the commit author's name + email. Without this, the DCO status check blocks the PR from merging.

Check current commits:

```bash
git log origin/main..HEAD --format='%h %an <%ae>%n%b%n---'
```

For each commit, verify the body contains a `Signed-off-by:` line whose name + email match `%an <%ae>`.

If any commit is missing the trailer:

- **Last commit only**: `git commit --amend --signoff --no-edit`
- **Multiple commits**: `git rebase --signoff origin/main`

After amending or rebasing, force-push to the contributor's fork: `git push --force-with-lease`.

### Step 5 — Compose the PR title and body

#### Title

Conventional commit form, lowercase after the colon, no trailing period, under ~60 chars:

```text
type(scope): concise lowercase description
```

`type` is one of: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`. Pick the one that best describes the change. `scope` is the primary affected package or layer (`sql-runtime`, `postgres-adapter`, `contract`, `cli`, `framework`, `mongo-orm`, etc.). If the change spans many packages, pick the one most central to the change.

Examples:
- `feat(sql-orm-client): support computed includes`
- `fix(postgres-adapter): handle null in jsonb columns`
- `docs(contributing): clarify pnpm install steps`

PR titles are the raw material the release-notes author triages when a version ships, so pick a title a downstream user would understand.

#### Body

Fill in the [pull request template](../../.github/PULL_REQUEST_TEMPLATE.md) sections in order:

- **Linked issue**: `Fixes #N` / `Refs #N`. If no issue exists because the change is small, write `n/a — small change`.
- **Summary**: one or two sentences focused on *why*, not file-by-file *what*. "Adds X because Y was broken" rather than "Adds X function in foo.ts and modifies bar.ts".
- **Testing performed**: list the actual `pnpm test:*` commands you ran. If you ran a manual repro (e.g. against the demo), say so.
- **Skill update**: say which agent skill the change teaches, or write `n/a — internal only` when the change touches nothing an agent skill describes. The checklist below asks you to confirm this section.
- **Checklist**: confirm DCO signoff, scope, tests, conventional title.
- **Notes for the reviewer** (optional): alternative approaches you considered, follow-ups intentionally deferred, anything you want the reviewer to focus on.

Do **not** include an "AI-authored" disclosure. Maintainers do not require it; it adds noise.

### Step 6 — Confirm with the user, then push and open

1. Show the user the proposed title + body in full and ask for confirmation.
2. After confirmation, push to the contributor's fork (`git push -u origin HEAD` from the contributor's branch in the fork).
3. Open the PR:

```bash
gh pr create --title "the title" --body "$(cat <<'EOF'
the body
EOF
)"
```

   The `gh` CLI must be authenticated against the contributor's GitHub account, not against `prisma/prisma` directly. The PR will open against `prisma:main` from the contributor's fork.

4. Return the PR URL.

5. Tell the user: a maintainer from `@prisma/ORM-TS-Maintain` will be auto-assigned via CODEOWNERS and is committed to a 5-business-day response window. If the change is large or controversial, expect a review thread before merge.

## Don'ts

- **Don't** rename `CONTRIBUTING.md` rules. If they've changed since this skill was written, follow the file, not the skill.
- **Don't** force a maintainer's email into a `Signed-off-by:` trailer. The DCO sign-off must be the contributor's own name and email matching the commit author.
- **Don't** open the PR with a failing local check. If `pnpm test:packages` is red, fix it before pushing.
- **Don't** include AI-disclosure boilerplate in the PR body, an "intent artifact" attachment, or any prompt logs. The project does not ask for these.
- **Don't** open public issues or PRs for security vulnerabilities. Use Private Vulnerability Reporting per `SECURITY.md`.
- **Don't** ask the user to share secrets, npm tokens, or anything they wouldn't put in a public commit.
