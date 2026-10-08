# Handover: activity tree design (ADR 267) and the cache invalidation project

Written 2026-10-08 by session chiron-22, for an agent starting in a fresh session and worktree. Will reads no briefs: explain every reference from scratch when you talk to him.

## Read first

- **This session's transcript**: `/Users/will/.claude/projects/-Users-will-Projects-prisma-orm--claude-worktrees-cache-invalidation-write-2de687/cb56e68c-91cd-4197-bbc1-b8e5319ca9fe.jsonl`. It covers 2026-10-07 and 2026-10-08: verifying halley-46's handover, the whole activity tree design discussion with Will, the ADR, the PR and its review. Pull out Will's turns with:

  ```bash
  jq -r 'objects | select(.type=="user" and (.message.content|type)=="string") | "=== \(.timestamp)\n\(.message.content)\n"' <transcript>
  ```

  Assistant turns need `.timestamp as $ts` bound before you descend into `.message.content`, or jq errors.
- **The previous session (halley-46)**: `/Users/wmadden/.claude/projects/-Users-wmadden-Projects-prisma-orm--claude-worktrees-middleware-cache-transaction-lifecycle-740886/80deccca-c0ba-4aa7-8021-5bf00e4cf86c.jsonl`. Readable as user `will`. It covers slice 1 (`afterTransaction`) and the first round of the grouping discussion.
- **ADR 267** and **`projects/activity-tree/design.md`** on PR prisma/orm#30653. The ADR is the decision; the design document holds the reasoning, scenarios and every rejected alternative.
- `projects/cache-invalidation-on-write/spec.md` and `plan.md` on `main`: the cache project, whose slice 2 is now in question (below).

Do **not** trust halley-46's handover (`docs/cache-invalidation-handover` branch). It claimed a ruling Will never made ("build the pragmatic cut now"; Will actually said "No, we still need to finish the design work"), and its discussion document recorded a rule ("parent pointers only, nothing walks down") that came from an assistant draft, not from Will or Serhii. Verify any claim about Will's rulings against his own words in the transcripts.

## State

| Item | State |
|---|---|
| prisma/orm#30653, ADR 267 + design document | Open, branch `docs/runtime-node-tree-adr` on the bot remote. Validated by the team on 2026-10-08. All CodeRabbit threads answered and resolved. CI monitor (Auto-fix) is on in chiron-22's session only; turn it on again for your session. Needs Will's approval; the bot cannot queue a merge. |
| ADR 267 status | `Proposed`. The team validated it; ask Will whether to flip it to `Accepted` before merge. |
| TML-3399 (`afterTransaction`, slice 1 of the cache project) | Done, merged in prisma/orm#30614. ADR 260. |
| TML-3400 (`invalidateAnnotation` on writes, slice 2) | Not started. Linear: Backlog, not blocked. Its description is stale against the spec (still says ADR 259, which is now ADR 266; says a stopped stream outside a transaction gets no stage, but ADR 260 gives it `unknown`; asks for a test the spec dropped). Whether to build it now is Will's open decision, below. |
| The activity tree itself | Designed, not ticketed, not built. |
| This handover | Branch `docs/activity-tree-handover` on the bot remote, one commit on top of the PR branch. Not for merge. |

## What ADR 267 decides, in one paragraph

The runtime's middleware sees a tree of **activities**. An activity is one act by an actor: the user calls an ORM method, the ORM opens a transaction and issues statements, a SQL builder user issues a query. The runtime hosts the tree and fires hooks; it starts nothing on its own. Every activity has three hooks: `activityStarted`, `activityEnded` (outcome `completed` or `failed`), and `activitySettled` (outcome `committed`, `rolled-back` or `unknown`). An activity with no enclosing transaction settles right after it ends; inside a transaction it settles when the outermost transaction ends, with its outcome (the Rails `after_commit` and Spring `afterCompletion` model). The user's annotations live on the activity they annotated; the SQL ORM starts an `orm-call` activity for every terminal and its statements carry no user annotations. Clients start activities with `startActivity({ kind, annotations })`, which returns an `ActivityHandle` shaped like a transaction handle; queries run through it are its children. User-facing types omit `startActivity`. Each activity has its own `ctx`; every hook of that activity receives the same one; `ctx.state(key)` returns a state object for any string or symbol key, unconstrained. `afterTransaction` becomes `activitySettled` on a query activity; ADR 160's `groupingKey` becomes the parent's identity.

## Open decisions for Will

1. **TML-3400.** Build the cache's write annotation now on `afterTransaction`, or as the first consumer of the activity tree. Recommendation in the design document: the tree. On `afterTransaction` the annotation reaches a plan only for single-statement writes (it is lost for relation-callback writes and multi-table-inheritance creates, verified in `collection.ts`), and the cache's hook would be rewritten when the tree lands.
2. **Ticket the tree** as its own project now, or leave it as the ADR until scheduled.
3. **ADR 267 to `Accepted`** before merge.

When the tree is implemented: ADR 160 and ADR 260 need supersession notes in the same PR (rule `adr-writing.mdc`), the subsystem doc `4. Runtime & Middleware Framework.md` needs the new lifecycle, and close-out moves anything long-lived out of `projects/activity-tree/`. The runtime stores `ctx.state` in a plain `Map`, since keys may be strings.

## Rules Will gave in this session

- Facilitate design as a partner; one question at a time; ground every claim in the code or docs first. Read the architecture docs, subsystem docs and ADRs before proposing.
- Don't argue from claims with no source. Audit a design from first principles when asked.
- Separate the ideal from the pragmatic, and don't overthink: when Will says "just make it X", make it X.
- Name things last. Names chosen: activity, `activityStarted`/`activityEnded`/`activitySettled`, `startActivity`, `ActivityHandle`.
- The runtime is not an actor; it executes other people's wishes.
- No question UI. Plain English. Use glossary words; define new words before using them.
- Every subagent on Opus (`model: "opus"`).

## Mechanics and gotchas

- Commit with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`; push through the `bot` remote. Never amend, rebase or force-push.
- Update a PR body with `gh api -X PATCH repos/prisma/orm/pulls/<n> -F body=@file`; `gh pr edit` fails under the bot token. The PR body source is in the gitignored `wip/activity-tree/pr-body.md` of chiron-22's worktree; fetch the current body from GitHub instead.
- **Never run a text replacement over `docs/architecture docs/ADR-INDEX.md` as a whole.** A rename pass did that here and corrupted the ADR 040 and ADR 247 rows; CodeRabbit caught it. Edit only the row you own.
- BSD `sed` on macOS has no `\b`; use `perl -pi -e`.

## Loose ends, none urgent

- The direct single-client Postgres driver runs a runtime-scope query inside an open transaction without the runtime knowing. This affects the shipped cache read path (it can store uncommitted rows). Not ticketed; search Linear before filing.
- paulwer's closed cache PR #30132: two Discord drafts in the asks system tell him the post-commit hook exists. Sending them is Will's call.
- The branch `docs/cache-invalidation-handover` on the bot remote is superseded by this PR and can be deleted with Will's go-ahead.
