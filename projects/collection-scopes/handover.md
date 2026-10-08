# Handover: collection scopes project

**Written:** 2026-10-08, by session voldemort-62, just before a rate limit. It supersedes the handover of 2026-10-07 (shonagon-99).

**Transcript of voldemort-62:** `/Users/will/.claude/projects/-Users-will-Projects-prisma-orm--claude-worktrees-model-scopes-brief-review-2336f8/5011b16b-8fe7-454e-bfa0-0564535567a3.jsonl`. It is JSONL. Will's own messages are the `type: "user"` entries that are not `isMeta` and do not start with `<task-notification`, `<system-reminder`, `<ci-monitor-event` or a skill body; they hold every ruling. Earlier transcripts live under the other macOS account and are readable from this one: shonagon-99 at `/Users/wmadden/.claude/projects/-Users-wmadden-Projects-prisma-orm--claude-worktrees-model-scopes-handover-86b983/04d397bd-668b-4b4d-aa7f-f8f9ff7a06e9.jsonl`, bragi-59 at `/Users/wmadden/.claude/projects/-Users-wmadden-Projects-prisma-orm--claude-worktrees-prometheus-67-transcript-38822b/4e95a23c-54dc-4602-9d06-65d2f2811331.jsonl`.

Memory for this project (this account): `~/.claude/projects/-Users-will-Projects-prisma-orm/memory/collection-scopes-project-state.md`. Update it when you finish.

Work as `~/.claude/CLAUDE.md` says: the Drive process, design with Will, execute without interrupting him, review every change, then hand to him. Explain every reference from scratch when you talk to him; he does not read briefs or tickets.

## What the project is

A developer writes a reusable piece of a query once and runs it on any collection it fits, with sound types. Read `spec.md` and `plan.md` here, then ADR 265 (a collection keeps its class through the chain), ADR 259 (query fragments are functions), ADR 161's section "A foreign key names its backing index", ADR 210 (index-type registry, including `fullText`), and the slice 4 draft ADR on this branch (`docs/architecture docs/adrs/ADR 260 - Packages offer collection scopes for their kinds of index.md`; main's ADR 260 is another decision, and main now goes up to ADR 266, so it becomes ADR 267).

## Vocabulary, as ruled by Will

- **Query fragment** (fragment): a function from a collection to a collection, run with `collection.with(fn)`. A **scope** is a fragment that only imposes conditions. A **row fragment** is a function of the model accessor, which `where` and `orderBy` take. The name `scope` is kept free for a later per-model default-scope feature (Will: "I fully approve").
- Public types: `QueryFragment` (was `Fragment`, was `Scope`), `DeclaredFieldsFragment` (was `FieldFragment`, was `FieldScope`), `FragmentFacts`. Methods: `db.orm.fragment(fields, body)`, `collection.fragment(body)`, `collection.with(fn)`.
- Rejected, never to be proposed again: `when()`; `modelStep`; declaring a fragment's fields by pointing at a model's field.

## State of every pull request

| What | PR | State on 2026-10-08 |
| --- | --- | --- |
| Slices 1, 2, `apply` → `with`, design ADRs 259/265 | #30543, #30560, #30564, #30635 | Merged earlier. |
| `scope` → `fragment` rename (TML-3512) | #30647 | Merged 2026-10-08. Ticket Done. |
| A foreign key names its backing index; the contract build removes duplicate indexes (TML-3430) | #30561 | Merged 2026-10-08. Ticket Done. Replaced the rejected `backsForeignKey` design. |
| Slice 3: weighted full-text index, stored as `fullText` data; queries name the index (`fns.fullTextMatches(post.indexes.post_search, q)`); `fullTextDocument(...)` for search without an index (TML-3431) | #30562 | Merged 2026-10-08. Ticket Done. |
| `Fragment` → `QueryFragment`, `FieldFragment` → `DeclaredFieldsFragment` (TML-3519) | #30652, branch `tml-3519-query-fragment-types`, tip d128a7bdc2 | **Waits for Will's review.** All checks green at the last look; bound to the old session with Auto-fix on. Main has moved since; merge main in and rerun checks before it is queued. Its upgrade entry `query-fragment-type-names` takes rc.16's `Scope`/`FieldScope` straight to the new names; the PR description asks the release assembler to merge it with `query-fragments`. |
| Slice 4 design draft (query fragments built from index definitions) | #30428, branch `model-scopes-design` (this branch) | Draft, conflicts with main. Next. |

## What to do next, in order

1. Bind #30652 to your session (`bind_pr`) and turn its monitor on. Merge main into it, rerun its checks, and when Will approves, queue it (`enqueuePullRequest` via GraphQL, or `set_auto_merge` if required checks are still running). Close TML-3519 with a comment after it merges.
2. Slice 4. First bring this branch up to date with main, renumber the draft ADR to 267, and update its vocabulary (`fulltextSearchScopes` → `fullTextSearchFragments`, `defineIndexScopes` → `defineIndexFragments`, `apply` → `with`, scope → fragment where the thing is not filter-only). Then rework the design onto what slice 3 shipped: the SQL builder's `TableProxy.indexes` gives a typed reference to each index with its columns bound to the table's alias, its `type` and literal `options`; `fns.fullTextMatches`/`fullTextRank` accept a `fullText` reference. The ORM has no `fns` in its `where` callback and an operation's first argument is always the field, so the ORM has no weighted search today; slice 4's fragments are where the ORM gets it, and they can reuse the index reference. Bring the reworked design to Will before building (he decides design; you decide representation details yourself). Also update `projects/collection-scopes/slices/3-weighted-full-text-index/spec.md`, which still says `options.fields` and that `fullText` declares it cannot back a foreign key (both stale).
3. After slice 4: manual QA across the feature, Will's final verification, then the default-scopes discussion.

## Follow-ups filed

- TML-3530: build warnings (`PN_INDEX_DUPLICATE`, `PN_INDEX_REDUNDANT`, `PN_EXACT_NAME_BODY_COMPARISON`) reach `contract emit --json` and the language server; today they go through `process.emitWarning`.
- TML-3490 (`upsert`/`create` ignore a filtered collection's filter): Will is giving it to Serhii. Not ours.
- Known limits recorded in the merged PRs: a `fullText` index and a hand-written `gin` expression index that render the same SQL are both kept; `fullTextDocument` cannot refuse a column named twice; the SQL builder raises `ORM.*` and the Postgres operations `RUNTIME.*` for mistakes in one call (older); the duplicate-index pass merges a key only on exactly the foreign key's columns, not a composite key it leads (a relation can name one with `index: "<name>"`).

## Checks before any push

Root `pnpm typecheck`; typecheck, lint, tests and coverage of every touched package (coverage inside each package; the root filter under-reports); demo `examples/prisma-8-demo` typecheck and tests, including `declaration-emit`; `pnpm fixtures:check`; `lint:deps`, `lint:throws`, `lint:casts`, `lint:agent`, `lint:skills`, `lint:framework-vocabulary`; `pnpm check:upgrade-coverage --mode pr --prev $(git merge-base origin/main HEAD) --head HEAD`; the integration files the change touches, one at a time (`cd test/integration && pnpm test test/<file>`), always `test/planner-golden/planner-ddl-golden.test.ts` when a committed `contract.json` changes. Three tarball tests (`cross-shell-tarball`, `all-shells-tarball`, `module-identity`) fail on this machine because `temporal-utils@1.0.3` is missing from the npm registry; they pass in CI.

## Things learned this round

- Read the architecture docs before proposing contract-shape changes: the Data Contract subsystem doc, ADR 161, ADR 243, ADR 009. Will was furious when a proposal came before reading them.
- Never bring Will representation details (how a contract field encodes a reference). Decide from the docs and mention it in one line.
- Fixtures, the demo migration history and the planner manifest are regenerated with the tooling (`pnpm fixtures:emit`, the demo regen script, `PLANNER_GOLDEN_WRITE=1`), never by hand; explain every moved recording.
- The upgrade skill forbids editing another merged PR's pending entry, and `check:upgrade-coverage` counts only new entries: add a new entry and tell the release assembler how they combine.
- `gh pr edit` fails under the bot token; update bodies with `gh api -X PATCH repos/prisma/orm/pulls/<n> -F body=@file`.
- In zsh, `"$B:examples/..."` applies a modifier; write `"${B}:path"` in git show commands.

## Standing rules

Name yourself first (`bash ~/.claude/scripts/agent-name.sh`). Push only through the `bot` remote. Commit with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"` and end messages with the `Co-Authored-By` line the session's attribution reminder gives. Never amend, rebase, squash or force-push. Use the shell's Node and pnpm, never npx. Never run the full integration, e2e or packages suites locally. Stay inside your worktree, working files under `wip/`. No question UI, no spawn_task chips. Subagents always on Opus. Write ADRs, specs and PR text yourself; subagents research, implement and review. Plain English, short, no hard-wrapped markdown. PR titles `TML-NNNN: sentence`; `Agent: <name>` above the attribution line. Bind every PR you own and turn its monitor on.
