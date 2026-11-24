# Prisma 8 GA plan

This folder holds the plan for shipping Prisma 8 GA. The target is the end of October 2026.

It lives on the branch `planning/prisma-8-ga`. The branch is for reading and sharing. It is never merged into `main`.

## Where to start

Read [plan.md](plan.md). It is one page. It lists every project in priority order, in seven streams, and says which projects GA cannot ship without.

| Stream | What it covers |
| --- | --- |
| 1 | Foundations and breaking changes |
| 2 | Upgrade path from Prisma 7 |
| 3 | Editor and tools |
| 4 | Query features |
| 5 | Docs and the new user's first hour |
| 6 | Work found along the way |
| 7 | Compatibility policy: from `8.0.0`, an application upgrades to any later `8.x` release with no changes. The policy itself is [spec.md](https://github.com/prisma/orm/blob/ga-compatibility/projects/ga-compatibility/spec.md) on the branch `ga-compatibility` |

If you work on language tools or queries, streams 3 and 4 are yours to read first.

## If you want to know why

| Question | Read |
| --- | --- |
| Why is a project in the plan, or ruled out? | [decisions.md](decisions.md) |
| Which pull request or ticket is behind a status in the plan? | [evidence.md](evidence.md) |
| What did we find in the code, docs and tests? | [context.md](context.md) |
| Which Prisma 7 query features does Prisma 8 lack? | [query-feature-gaps.md](query-feature-gaps.md) |
| What did the getting-started eval find? | [eval-friction-2026-09-28.md](eval-friction-2026-09-28.md) |

## How to read the plan

- Work happens in all streams at once. Inside a stream, the order is top to bottom.
- **Must** means GA does not ship without it. **Aim** means wanted at GA, but it can ship just after. **Later** means after GA.
- Breaking changes come first, because GA is the last chance to make them.

## How much to trust it

- [plan.md](plan.md), [evidence.md](evidence.md) and [decisions.md](decisions.md) are kept current.
- The states in the plan are as of 2026-10-20.
- [query-feature-gaps.md](query-feature-gaps.md) and [open-projects.md](open-projects.md) are snapshots. Some entries are already out of date. Check the code before you act on one.

## How to change it

Tell Will, or push a commit to this branch. Do not open a pull request from it.

Agents that continue the planning discussion start from [for-agents.md](for-agents.md).
