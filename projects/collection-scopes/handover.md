# Handover: collection scopes project

**Written:** 2026-10-09 by daedalus-71. It supersedes every earlier handover.

Read [spec.md](spec.md) and [plan.md](plan.md) first; they are the source of truth. Then ADR 265, ADR 259 and ADR 270 (Proposed, on this branch).

## Where Will's decisions are

Will's decisions are in his messages in these transcripts (JSONL; his messages are `type: "user"` entries that are not `isMeta` and are not tool results or system notices):

| Session | Dates | Topic | Path |
| --- | --- | --- | --- |
| prometheus-67 | 2026-09-22 to 09-30 | Full-text search design, collection scopes from indexes, the package helper, the start of `pipe` | `/Users/wmadden/.claude/projects/-Users-wmadden-Projects-prisma-orm--claude-worktrees-postgres-fts-follow-ups-c8df45/39bcce7e-6534-4f35-973d-b39a460ed895.jsonl` |
| bragi-59 | 2026-09-30 to 10-05 | Collection type, `apply`/`with`, scope vocabulary, fragment helpers | `/Users/wmadden/.claude/projects/-Users-wmadden-Projects-prisma-orm--claude-worktrees-prometheus-67-transcript-38822b/4e95a23c-54dc-4602-9d06-65d2f2811331.jsonl` |
| shonagon-99 | 2026-10-06 to 10-07 | `with`, "query fragment" vocabulary | `/Users/wmadden/.claude/projects/-Users-wmadden-Projects-prisma-orm--claude-worktrees-model-scopes-handover-86b983/04d397bd-668b-4b4d-aa7f-f8f9ff7a06e9.jsonl` |
| voldemort-62 | 2026-10-07 to 10-08 | Foreign key backing index, slice 3, queries name the index | `/Users/will/.claude/projects/-Users-will-Projects-prisma-orm--claude-worktrees-model-scopes-brief-review-2336f8/5011b16b-8fe7-454e-bfa0-0564535567a3.jsonl` |
| daedalus-71 | 2026-10-08 to 10-09 | Takeover, slice 4 redesign (ADR 270), TML-3543 | `/Users/wmadden/.claude/projects/-Users-wmadden-Projects-prisma-orm--claude-worktrees-model-scopes-brief-review-2fbc39/435ee4d2-e097-4d64-b060-98a8c7356ab0.jsonl` |

## The sequence Will agreed on 2026-10-09

1. Done: the SQL query builder names an index (`fns.fullTextMatches(post.indexes.post_search, q)`).
2. Slice 4: ORM `where` and `orderBy` callbacks receive `{ fns, indexes }` (ADR 270, option B; Will chose it over methods on index references).
3. Later: collection scopes built from indexes, `db.Post.scopes.search.fulltext(q)`, from the September draft ADR on branch `spike-collection-scope-declared`.

## Standing rules

Name yourself first. Push only through the `bot` remote. Commit with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`. Never amend, rebase, squash or force-push. Run node and pnpm through `mise exec --`. Never run the full integration, e2e or packages suites locally. Stay inside your worktree, working files under `wip/`. No question UI, no spawn_task chips. Subagents on Opus. Write ADRs, specs and PR text yourself. Plain English, short, no hard-wrapped markdown. PR titles `TML-NNNN: sentence`; `Agent: <name>` above the attribution line. Bind every PR you open and turn its monitor on.
