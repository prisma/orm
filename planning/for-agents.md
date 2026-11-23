# Instructions for agents

Notes for planning Prisma 8 GA with Will Madden, shared with the team. They live on the branch `planning/prisma-8-ga` in `prisma/orm`. Fetch it from and push it to the `bot` remote. Other sessions push here too, so fetch and merge before every push, and confirm the push with `git ls-remote`. Never open a pull request from it and never merge it into `main`.

This file is for an agent picking up the planning discussion with Will. People should read [README.md](README.md). Start with [handover.md](handover.md), then read this file, then [plan.md](plan.md), [decisions.md](decisions.md) and [context.md](context.md). Read the other files only when the discussion needs them.

## Files

| File | What it holds | How current |
| --- | --- | --- |
| [plan.md](plan.md) | The projects in priority order, by stream | Kept current. This is the source of truth for order. |
| [ga-readiness/](ga-readiness/) | Stream 7. Start with `handover.md`. The compatibility policy (`spec.md`), the maturity levels (`maturity-levels.md`), its tasks (`plan.md`), and the analysis and research behind them | Agreed with Will 2026-11-23. `spec.md` holds only agreed decisions. |
| [evidence.md](evidence.md) | The pull requests, tickets and dates behind each status in plan.md | Kept current with plan.md. |
| [decisions.md](decisions.md) | Every decision Will has made, with reasons, and the principles | Kept current. |
| [context.md](context.md) | Findings and reasoning behind the decisions, and the changes made in Linear and pull requests | Written 2026-09-29 |
| [query-feature-gaps.md](query-feature-gaps.md) | What Prisma 7 queries can do that Prisma 8 cannot | Gathered 2026-09-28. Several entries were found to be stale. Check the code before relying on a line. |
| [eval-friction-2026-09-28.md](eval-friction-2026-09-28.md) | The 36 friction items from one nightly run of the getting-started eval, sorted by owner | A snapshot of one run |
| [open-projects.md](open-projects.md) | First inventory of Linear projects and open pull requests | A snapshot of 2026-09-28. Superseded by plan.md where they differ. |

## How to work with Will in this discussion

1. This is a discussion. Do not produce drafts, strategies or documents unless Will asks. Ask, listen, and record what he decides.
2. Plan for the team as a whole. Do not ask who builds what, and do not comment on how work is split between people.
3. Stay on the big picture unless Will asks for detail.
4. Answer factual questions from the code, the pull requests and Linear before asking Will. When you state that something exists or is missing, say whether you verified it.
5. Treat notes that Will pastes in as input, not as decisions, unless he says otherwise.
6. When Will decides something, write it into decisions.md in the same turn, and update the order in plan.md if it changes. Commit and push.
7. Keep tracking in these files. Do not create Linear tickets for plan items unless Will asks. TML-3340 is the one exception so far.
8. Write short, plain English. Follow the global rules in `~/.claude/CLAUDE.md`.

## How to refresh the facts

Linear and the ported test records drift from the code. Before relying on a status:

- Work on a row can live in prisma/composer or prisma/prisma-cli as well as prisma/orm. Search open and merged PRs in all three, and the code, before calling a row not started.
- Re-read the state of every PR you report right before you report it. PRs merge between checks.
- Merging a PR closes the ticket in its title, including ADR-only PRs. Check ticket states against the code and reopen wrongly closed tickets.
- `StevenMcClankerton` is Serhii's bot account; `wmadden-electric` is Will's.
- A project that has started is Must (Will, 2026-10-16), and counts toward GA readiness.
- After changing any Progress cell, recount the "How far from GA" table at the top of plan.md and the "GA readiness" line under each stream heading.

- Open pull requests by the bot: `gh search prs --author wmadden-electric --state open`
- Whether a ticket is done: search pull requests for its identifier, then read the code.
- The eval: the newest scheduled run of "Nightly getting-started check" in `prisma/getting-started-eval`. The `report` artifact holds `report.md` and `report.html`.
- Public positions: `apps/docs/content/docs/orm/coming-from-prisma-orm-7.mdx` and `release-status.mdx` in `prisma/web`.
- Designs in progress sit on local branches in other worktrees: `data-types-completion` (rest of ADR 254) and `tml-3282-sql-expression-literals`. Read them with `git show <branch>:<path>`.

## Open questions, as of 2026-09-29

Will has not answered these yet. Ask them when the discussion resumes, a few at a time.

1. Should the required work be laid out week by week, to test whether October is realistic?

Settled and not to be raised again: ADR numbering (fixed), stale In Progress issues in Linear (moved back to To-do on 2026-09-29), the eval's ORM scenario (a task in plan.md).

## Work agreed for after the plan is finished

- Update every record that contradicts the code: the ported test records and the documents listed in query-feature-gaps.md.
- Decide whether plan items become Linear tickets.
