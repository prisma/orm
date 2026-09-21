# Contributing to Prisma 8

Thanks for your interest in Prisma 8. This document is the entry point for external contributors. Maintainer-onboarding lives elsewhere ([`AGENTS.md`](./AGENTS.md), [`docs/onboarding/`](./docs/onboarding/)) and may be linked as deeper-dive reference, but you do not need it to file a bug report or open a PR.

## Status — please read first

Prisma 8 ships as a release candidate (`8.0.0-rc.N`), and `8.0.0` final is expected within four to eight weeks. While we are on the release-candidate line:

- **Expect breaking changes between release candidates.** APIs, contract schemas, on-disk formats, and CLI flags can shift without a deprecation cycle. Every release ships an upgrade recipe under [`skills/prisma-8/upgrading/`](./skills/prisma-8/upgrading/) that the `prisma-8` skill applies, and the churn settles as we approach final.
- **Only the latest Prisma 8 release receives security fixes.** Older Prisma 8 releases are not backported. Prisma 7 is the exception: it receives security updates for eighteen months after `8.0.0` final, on the `v7` branch. See [`SECURITY.md`](./SECURITY.md).
- **New projects should start on Prisma 8.** The release candidate is a complete implementation; the gap you are most likely to hit is a feature that is not built yet, and the [feature scoreboard](./scorecard.md) names each one. Existing [Prisma 7](https://www.prisma.io/docs/orm) applications should migrate incrementally. Prisma 7 continues on the [`v7` branch](https://github.com/prisma/orm/tree/v7) and receives bug fixes and security updates for eighteen months after `8.0.0` final.

## Before you start a substantive change

For typo fixes, doc nits, small bug fixes, and obvious improvements: **just open a PR**.

For anything substantive — a new feature, a refactor, a new operation, a new adapter, or anything you are not confident a maintainer would automatically agree with — **please open an issue first** so we can give you direction-fit feedback before you invest implementation time. Maintainers will respond within 5 business days. This saves both sides effort: a half-day issue conversation can prevent a one-week PR rewrite.

If your change is substantial, expect that landing it may require coordination on follow-up work (docs, examples, related packages). Maintainers will tell you if that's the case when you open the issue.

## Prerequisites

You need:

- **Node.js** matching the `engines.node` field in [`package.json`](./package.json) (currently `>=24`). We recommend installing via [`mise`](https://mise.jdx.dev/) using the in-repo `.tool-versions` / `mise.toml` (the repo's CI uses `mise` to provision the right Node version, so following the same path keeps you aligned).
- **pnpm** via Corepack: `corepack enable` and then any `pnpm` command will use the version pinned by `packageManager` in `package.json`. Do not install pnpm globally with another package manager.
- **git** with commit signoff configured (see [DCO](#developer-certificate-of-origin-dco) below).

Optional, only needed for specific test suites:

- **Docker / `docker compose`** — required only for the Cloudflare Worker integration tests (`pnpm test:vite-plugin`). All other test suites (unit, e2e, integration) use embedded databases (PGlite for Postgres, mongodb-memory-server for Mongo) and don't need Docker.

## Setup

```bash
git clone https://github.com/prisma/orm.git
cd orm

corepack enable                      # if you haven't already
pnpm install --frozen-lockfile
pnpm build                           # required before running most test suites
```

If `pnpm install` warns about a Node version mismatch, your shell isn't pointing at a Node version that satisfies `engines.node`; fix your environment rather than working around it (see the project's `mise` setup).

## Running checks

The repository uses [Turbo](https://turbo.build/repo/docs) to scope tasks to changed packages, so most commands are fast on warm caches. Pick the suite that matches the scope of your change:

| Change scope                       | Command                              |
| ---------------------------------- | ------------------------------------ |
| Type errors only                   | `pnpm typecheck`                     |
| Lint / formatting                  | `pnpm lint`                          |
| Unit tests in `packages/**`        | `pnpm test:packages`                 |
| Examples                           | `pnpm test:examples`                 |
| Postgres / SQLite e2e              | `pnpm test:e2e`                      |
| Database integration               | `pnpm test:integration`              |
| Vite plugin / Cloudflare Worker    | `pnpm test:vite-plugin` *(Docker)*   |
| Everything                         | `pnpm test:all`                      |

Other useful commands:

```bash
pnpm lint:fix                        # auto-fix lint issues
pnpm lint:deps                       # validate package layering and imports
pnpm lint:manifests                  # check publishable packages declare a license
pnpm fixtures:check                  # regenerate and diff contract fixtures
```

Before opening a PR:

```bash
pnpm typecheck && pnpm lint && pnpm test:packages
```

If your change touches the SQL or Mongo runtime, also run `pnpm test:integration` and/or `pnpm test:e2e`.

## Developer Certificate of Origin (DCO)

Every commit on a PR must be signed off under the [Developer Certificate of Origin 1.1](https://developercertificate.org/). The DCO is a lightweight statement that you have the right to submit the contribution under the project's license (Apache-2.0); it is *not* a Contributor License Agreement and does not transfer copyright. (For the reasoning behind choosing DCO over CLA, see [`docs/oss/governance.md`](./docs/oss/governance.md#contributor-provenance).)

To sign off a commit, append a `Signed-off-by:` trailer with `git commit -s`:

```bash
git commit -s -m "feat(sql-orm-client): add SomeFeature"
```

This adds:

```text
Signed-off-by: Your Name <your.email@example.com>
```

The trailer name and email must match the commit author. If you forget, you can sign off the most recent commit with:

```bash
git commit --amend --signoff
```

A GitHub status check will fail if any commit on the PR is missing a `Signed-off-by:` trailer that matches the author. The check links to a per-PR remediation page if you need to retroactively sign off a series of commits.

## Pull request expectations

When you open a PR, the [pull request template](./.github/PULL_REQUEST_TEMPLATE.md) will be pre-filled. Please:

1. **Link the issue you opened** (or "n/a — small change" if you skipped step 1 because the change was small).
2. **Summarise the change** in one or two sentences focused on *why*, not file-by-file *what*.
3. **List the testing you ran.** "Ran `pnpm test:packages`" is fine for small changes; bigger changes should run more.
4. **Confirm DCO signoff.** The status check will tell you if anything is missing.

A few conventions that will save review round-trips:

- **One logical change per PR.** If you find an unrelated bug while working, file a separate issue or open a separate PR.
- **Conventional commit titles.** PR titles drive the auto-generated GitHub Release notes, so `feat(sql-orm-client): support computed includes` is more useful than `update sql-orm-client`. Common prefixes: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`.
- **Update tests in the same PR.** A behavioural change without a test usually triggers a review comment asking for one.
- **No backward-compat shims.** Prisma 8 is still on the release-candidate line; if you change an API, update the call sites instead of leaving an alias behind.

We do not ask whether a PR was AI-assisted. We do verify the result. If you used an LLM-based agent to author the change, see [Working with agents](#working-with-agents) below.

## Working with agents

If you use an LLM-based agent (Claude, Cursor, Codex, etc.) to author or review your contribution, the [`contrib-pr` skill](./.agents/skills/contrib-pr/SKILL.md) encodes the contribution flow as an agent-runnable workflow: scope the change, write tests, run the right suites, sign off the commit, fill the PR template, link the issue. Pointing your agent at this skill is the easiest way to keep the contribution shape consistent without you having to coach the agent through this document. (For Claude users, the same file is also reachable as `.claude/skills/contrib-pr/SKILL.md` via a workspace symlink.)

The skill is intentionally a "pit of success", not a gate — there is no enforcement in CI that you used it. We rely on the result (passing tests, scoped change, well-formed PR) to do the verification.

## Reporting bugs

Use the [bug report issue template](./.github/ISSUE_TEMPLATE/bug_report.yml). Please include:

- The published `@prisma/*` package and version (or the `prisma` CLI version).
- A minimal reproduction (the smaller the better — we cannot triage "my whole app is broken" reports without isolation).
- Expected vs actual behaviour.
- Whether you are on the latest minor; if not, please upgrade and re-verify before filing.

## Reporting security issues

**Do not file public issues for security reports.** Use [`SECURITY.md`](./SECURITY.md) and follow the GitHub Private Vulnerability Reporting flow.

## Discussion / questions

Open-ended questions, design feedback, or "is this the intended way to do X" go to the **[Prisma Discord server](https://pris.ly/discord)**. For specific bugs or concrete feature requests, please use issues — Discord conversations are easy to lose.

## Code of Conduct

Participation in this project is governed by the [Code of Conduct](./CODE_OF_CONDUCT.md). To report a possible CoC violation, see the *Reporting an Issue* section there.
