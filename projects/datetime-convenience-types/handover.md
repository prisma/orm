# Handover — Convenience date and time types

Written 2026-10-23 by the agent `thales-11`, before a rate limit. Read this whole file, then the transcript, before acting.

**Transcript (full context, including every ruling of Will's in his own words):** `/Users/will/.claude/projects/-Users-will-Projects-prisma-orm--claude-worktrees-prisma8-datetime-usability-5a9ffb/a52854a5-d212-46e3-996d-71bf5a31c118.jsonl`. It is long; filter Will's own messages with `jq -r 'select(.type=="user" and (.message.content|type)=="string") | .message.content' <file>`.

Linear: project "Convenience date and time types" (TML-3709). Repository `prisma/orm`. Push only through the `bot` remote (`git@github-wmadden-electric:...`); commit with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"` and end messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## What the project is

PostgreSQL date and time fields in Prisma 8 had a dozen database-named "explicit" types (`TimestamptzJsDate`, `TimestamptzTemporal`, `DateString`, …), each naming the database type and the JavaScript value read, and no obvious one to start with. The project adds **convenience types**: a general mechanism where a target declares a type named for what a field means (`DateTime`, `Date`, `Time`, `Duration`), whose options pick exactly one explicit type from a table, with defaults that need no setup. The contract stores only the explicit type. The tools (`contract infer`, `contract print`, the Prisma 7 schema reader, `orm init`) write the convenience form.

The design record is **ADR 279 — Convenience types choose an explicit type from their arguments** (`docs/architecture docs/adrs/`). It was just rewritten as a general mechanism with PostgreSQL dates as the first use. Read it first. The project spec, plan and per-PR specs are in this folder.

```prisma
model Order {
  paidAt    DateTime                      // exactly TimestamptzJsDate(3)
  settledAt DateTime(as: temporal)        // exactly TimestamptzTemporal
  legacyAt  DateTime(storage: timestamp)  // exactly TimestampJsDate(3)
  shipBy    Date                          // exactly DateString
}
```

## Settled decisions — do not reopen

Will ruled each of these; quotes are in the transcript.

- Two kinds of type: explicit types (one codec each, named after the database, suffix for the value when a database type has several codecs) and convenience types (a framework descriptor `kind: 'typeChoice'` with option arguments, handed-on arguments and a `choices` table). Not a parameterized codec, not an alias, not the preset select machinery. `@db.*` never comes back.
- Options are **`as:`** (value read: `jsDate`, `temporal`, `string`, `parts`) and **`storage:`** (database type). Renamed from `value:`/`column:` on 2026-10-23; values unchanged. TypeScript helpers take **one object**: `type.DateTime({ as: 'string', precision: 6 })`. Explicit constructors stay positional.
- Defaults: `DateTime` = `TimestamptzJsDate(3)`; `Date`, `Time`, `Duration` = ISO 8601 strings. No polyfill needed. Temporal TypeScript types come from `temporal-spec` (types only); the polyfill is never bundled.
- No backward compatibility before RC: string codecs keep their ids when they switch to ISO; renames are outright.
- `DateStyle=ISO`: the PostgreSQL target declares it as `sessionSettings`; the driver ensures it on every connection (startup option on connections it opens, `set_config` on supplied pools/clients before first use and after exclusive release). Recorded in ADR 159.
- Prisma 7 reader: `@default(now())` becomes `@default(now()) @onCreate(now())`. Prisma 7 `DateTime` becomes `TimestampJsDate(3)` (printed `DateTime(storage: timestamp)`).
- `contract infer` always takes the default path where possible. An omitted precision compares equal to 6 (data type normal form); planner postcheck catalog text uses the precision as written (`catalogParams`).
- The `Date` codecs (`pg/timestamptz-date@1`, `pg/timestamp-date@1`, MySQL datetime) refuse in `fromDataTypeValue` a stored value with digits below a millisecond (ADR 254's rule that a codec refuses what it cannot hold exactly). Rows (`fromWire`) keep dropping the digits. Infer keeps an exactness check (beside its JSON one) and prints such a default as raw SQL; the Prisma 7 binding writes refused defaults via `refusedLiteralDefault`. `db verify` cannot see a sub-millisecond default difference on a `Date` column — accepted and documented.
- Scope: PostgreSQL only. SQLite, MySQL, MongoDB convenience types are TML-3714; other scalars TML-3715.

## The PR stack (all awaiting Will's review — open no new PRs until these are cleared)

| PR | Branch | Base | State |
| --- | --- | --- | --- |
| #30834 design | `tml-3709-plan-datetime-convenience-types` | `main` | pushed; ADR 279 rewritten (general); description rewritten |
| #30851 ISO strings (TML-3418) | `tml-3418-iso-string-date-time-codecs` | design | pushed, last CI green before the latest DateStyle commit 5c16f01456; check CI |
| #30839 Prisma 7 now() (TML-3719) | `tml-3719-prisma7-now-default-generator` | design | pushed, green |
| #30844 explicit types (TML-3711) | `tml-3711-explicit-date-time-types` | design | pushed, green |
| #30847 convenience types (TML-3712) | `tml-3712-convenience-date-time-types` | #30844 | pushed PR branch still has `value:`/`column:`; rename in progress (below) |
| #30858 tools (TML-3713) | `tml-3713-tools-write-convenience-types` | #30847 (merges #30839 in) | pushed PR branch still has old names; rename and three fixes in progress |

Worktrees live under the shaping worktree: `wip/slices/<branch>`. `wip/slices/final-review` is a local-only branch merging everything (never push it).

## In flight when this was written

An implementer was renaming `value:`→`as:`, `column:`→`storage:` and making the TypeScript type-choice helpers take an object, first on #30847's branch, then merging the design branch (new ADR 279 file name: take it as is, delete the old file, update every link to the old name/title), then merging into #30858's branch and updating infer/print/Prisma 7/init expectations, fixtures, docs and upgrade instructions. Then three fixes on #30858's branch:
1. `timestampNow` for the Date codecs rounds down to the column precision (Prisma 7 `@db.Timestamp(0) @updatedAt` generated `.700`, stored `:01`); PGlite test for precision 0–2.
2. `RUNTIME.TEMPORAL_UNAVAILABLE` fix text (Postgres target `errors.ts` ~line 91) and its error-reference entry: remove `temporal.createdAtString()`, list every Temporal codec incl. `pg/timestamp-instant@1`, point to the convenience defaults.
3. `upgrade-instructions/pending/tools-write-convenience-types/app/instructions.md` ~37–39: don't say Prisma 7 date/time strings are "unchanged" (the ISO PR changes them).

Its work was checkpointed to backup branches **`bot/wip/tml-3712-as-storage`** and **`bot/wip/tml-3713-as-storage`** (see "Status of the backup branches" at the end). Resume from those: verify, finish, run gates, then fast-forward or push the PR branches.

## Remaining work, in order

1. Finish the rename and the three fixes above; run the gates (package tests with coverage/lint/typecheck for touched packages, the affected integration files and journeys, `pnpm fixtures:check`, `lint:deps`, `lint:ratchets`, `lint:docs`, `check:upgrade-coverage --mode pr --prev <base>`). Push #30847 and #30858; watch CI.
2. Update the descriptions of #30834, #30847 and #30858 for `as:`/`storage:`, the object form and the general ADR (current bodies are in the gitignored `wip/pr-rewrite/*.new.md` of the shaping worktree; regenerate from the PRs if gone: `gh pr view <n> --repo prisma/orm --json body`). `gh pr edit` fails with the bot token; use `gh api -X PATCH repos/prisma/orm/pulls/<n> -F body=@file`.
3. Run `/drive-code-review` (no walkthrough) on the final combined result again after the rename, as Will asked; the last one found 7 issues, all now fixed or queued (see transcript).
4. When Will approves a PR: turn on auto-merge (squash); stacked branches rebase with `--onto` after a squash merge; close the Linear ticket with a comment. Merge conflict to expect between #30851 and #30844 in `date-codecs.ts` `decodeDate`: keep `requireIsoDateStyle` inside the shared `decodeDate`; `date-style-every-codec.test.ts` fails otherwise. The convenience journey's `textAt`/`localAt` values become `2024-02-29T10:00:00.123456Z` and `09:30:00+02:00` when #30851 and #30847 meet.
5. Close-out after all merge: retro, docs migration, delete this `projects/` folder.

## How Will wants you to work (from his CLAUDE.md and this session)

- Name yourself first (`bash ~/.claude/scripts/agent-name.sh`), prefix the session title, put `Agent: <name>` in PRs.
- **Read the design docs before any design opinion** (ADRs in full including Alternatives, glossary, vision). Before instructing an implementer on a design change, research the code and records yourself; say when a proposal reverses a recorded decision. Will was furious when I relayed a rework ADR 254 had rejected.
- Plain, short English; no ADR numbers or internal labels without saying what they mean; no invented jargon; banned words in his CLAUDE.md.
- ADRs and PR descriptions: open with a grounding example, lead with the decision, build up step by step, end with alternatives; ADRs carry no tickets, slices or history.
- Write docs, ADRs and PR text yourself; subagents implement and review. Subagents always `model: "opus"`.
- Decide routine and representation calls yourself; ask Will only for real decisions, with a recommendation.
- Don't open new PRs while the project's PRs await review. No session-proposal cards; follow-ups go to Linear.
- Never kill processes by pattern. Never re-run CI without Will's go-ahead; report flakes. Stay inside the worktree.

## Status of the backup branches

- **`bot/wip/tml-3712-as-storage` at `b6bb9ffad6`** (WIP commit, signed off; local `tml-3712-convenience-date-time-types` is the same). Done: the `as:`/`storage:` rename everywhere on that branch (declarations, tests in every package, the integration file, parity test, journey, `scalar-types.md`, `error-reference.md`, Serverless guide, `gotchas.md`, ADR 275 note, `skills/prisma-8` contract and debug references, pending upgrade instruction, READMEs), and the TypeScript object form (one overload per row; options required only when not the default; unknown key, unlisted combination, unaccepted argument and positional calls fail to compile, with negative type tests; runtime `typeChoiceArgumentsFromObject` in framework-components converts the object to the argument list). The no-row refusal now reads `Argument "storage" of Time cannot be timetz with as: temporal; write one of: time.` Package tests, lint, typecheck, coverage, integration, journeys, `lint:deps`, `lint:ratchets`, `lint:docs` and `check:upgrade-coverage` passed (a few timing tests in language-server and the facade timed out under a load average of 70–140; unrelated files).
- **Not done on it:** `pnpm fixtures:check` fails: its diff is in `skills/prisma-8/references/contract.md` (the "Date and time types" and "Temporal columns" paragraphs), so some generated copy of the skill reference disagrees with the edited source; investigate (`pnpm fixtures:check` output was in the gitignored `wip/gates/` of that worktree). Then amend the WIP commit into a proper one, merge the design branch (new ADR 279 file), fix links, push the PR branch.
- **`bot/wip/tml-3713-as-storage` does not exist:** the tools branch work (merge, rename in what the tools write, and the three fixes) was never started. `bot/tml-3713-tools-write-convenience-types` is unchanged.
