# Handover: convenience date and time types on SQLite, MySQL and MongoDB (2026-10-30)

Written by the session `iris-21` when it hit its rate limit. It covers the whole project, not only the open slice.

## Read first

- **Transcript of this session** (readable on Will's machine): `/Users/will/.claude/projects/-Users-will-Projects-prisma-orm--claude-worktrees-tml-3714-convenience-types-targets-929d89/bbdb7c29-aa5d-4c65-8648-90b85d252357.jsonl`. Will's own messages: `jq -r 'select(.type=="user" and (.message.content|type=="string")) | .message.content' <file>`. Read them: several rulings below came with strong feedback.
- **Project docs** (all in `projects/convenience-types-other-targets/`, on branch `tml-3714-mysql`): `spec.md` (decisions and the per-target tables), `plan.md` (slices), `specs/slice-1-type-implementations-and-sqlite.spec.md`, `specs/slice-2-mysql.spec.md`, `specs/slice-3-mongo-ts-type-helpers.design.md`.
- **ADRs written by this project**: ADR 314 (the shared package) and ADR 315 (each target's convenience tables). Also read ADR 279 (the mechanism, with its Alternatives), ADR 257, ADR 254's date and time section, ADR 241, ADR 242, ADR 278.
- **Review files** (gitignored in the repo, so copied outside it): `/Users/will/Library/Application Support/Claude/side-session-notes/local_fc83fc84-a360-49fc-a8d7-27b14ca1a49e/tml-3714-reviews/` — `sqlite/system-design-review.md` and `sqlite/code-review.md` (two rounds, all fixed), `mysql/system-design-review.md` (round 1, not yet acted on). The same folder has `gates.sh` (the pre-PR check script) and `watch-pr.sh` (a PR watcher).
- **Repo rules**: `CLAUDE.md`, `.agents/rules/`, Will's global `~/.claude/CLAUDE.md` (name yourself, plain English, bot identity, push via the `bot` remote, Opus subagents, Auto-fix and auto-merge, follow every PR to the merge).

## What the project is

Linear: TML-3714 (the ticket Will ranked second among the convenience-types follow-ups). PostgreSQL got the convenience types `DateTime`, `Date`, `Time` and `Duration` in ADR 279: a type named for what a field means, whose optional `as:` (the value the application reads) and `storage:` (the database type) arguments pick exactly one of the target's explicit, database-named types; the contract stores only the explicit type. This project gives the same four to SQLite, MySQL and MongoDB, through the Drive process (`/drive-process`): spec, plan, slices, Opus implementers, two-pass `/drive-code-review` without the walkthrough, fixes, PR.

Done means: every target's table works end to end (emit, plan, migrate, read, write, with and without a global `Temporal`); each target's example app runs it in CI; docs, skills and upgrade instructions updated; PRs merged; TML-3714 set to Done.

## Will's rulings (do not reopen)

- **A convenience name is the same concept on every target, not the same representation.** `Date` is a calendar date everywhere; each target picks its storage and value (ADR 315).
- **Research the ecosystem before asking him.** MongoDB's calendar date is a BSON date at midnight UTC because the Java driver's `LocalDateCodec` and the C# driver's `DateOnlySerializer` write that, and PyMongo's docs say so. He said a question the drivers answer "didn't really need me".
- **The framework is not a dumping ground for code reuse.** Code several targets share goes in a scoped package placed by the layering docs. Hence `@internal/type-implementations` at `packages/3-targets/0-shared/type-implementations`, in the `targets` domain (ADR 314). He named the scope "shared code related to type implementations"; "application-values" "means nothing".
- **MongoDB's TypeScript builder aligns with PostgreSQL's**, as its own slice before MongoDB's convenience types: its helpers must come from the contributed type constructors (ADR 241), not be hard-coded. If Mongo's design had been an improvement, the others would have aligned to it; it is not (ADR 275 records the gap).
- Raise to him before changing `packages/1-framework` or `packages/2-sql-family`; decide everything else, and say the literal thing in plain English.

## Decided by this session (recorded in the spec and ADRs)

- An existing `DateTime` keeps its contract on SQLite, MySQL and MongoDB: it becomes a type choice whose default is today's type, renamed (`DatetimeJsDate` on SQLite and MySQL, `DateJsDate` on MongoDB).
- SQLite: everything stored as text; `storage: text` only; new data types `sqlite/date`, `sqlite/time` (always 3 fraction digits), `sqlite/duration` (as written). No `storage: integer`.
- MySQL: new `mysql/timestamp`, `mysql/date`, `mysql/time`, `mysql/duration` (stored as text); `jsDate` rows default precision 3, `temporal` and `string` rows 6; full table in the slice-2 spec.
- MongoDB (slice 4, not started): `DateTime` over a BSON date (`DateJsDate` = today's `mongo/date@1`, `DateInstant`, `DateInstantString`); `Date` a BSON date at midnight UTC (`DateString`, `DateTemporal`, refusing non-midnight values); `Time` and `Duration` BSON strings. `Date` changes concept at once (today's `Date` is a moment in time), with an upgrade instruction that rewrites it to `DateTime`; a missed rewrite fails loudly on the first read.
- `Duration` on targets without an interval type is an ISO 8601 string, `as: string` only.
- `@internal/type-implementations` is published inside `@prisma/orm-framework` (one copy, one fallback `Temporal` per process); ADR 314 records that this amends ADR 242.
- TML-3767 (resolve a type choice once per field) was not done first: it does not simplify this work.

## State of each slice

| Slice | Linear | Branch | State |
| --- | --- | --- | --- |
| 1. `@internal/type-implementations` and SQLite | TML-3780 | `tml-3714-type-implementations-and-sqlite` | PR prisma/orm#30922 open, awaiting Will's review. Two review rounds fixed. Last pushed head `73a7d96a07`. CI had failed on codec-enumerating tests; fixed and pushed, CI not yet re-checked |
| 2. MySQL | none yet (create one, like TML-3780) | `tml-3714-mysql` (stacked on an older slice-1 tip, `581e8ecbed`) | Implemented, all local gates green against MySQL 8.4; system-design review round 1 written (D01–D12), code review was interrupted before writing its file; no PR |
| 3. MongoDB TypeScript builder takes contributed type constructors | none yet | none | Design note written; two questions put to Will, unanswered (below) |
| 4. MongoDB convenience types | none yet | none | Not started; needs slice 3 |
| 5. Close-out | — | — | Not started |

### Slice 1 details

- PR body: written from `wip/tml-3714/pr-body.md`; it names ADR 314/315 (renumbered from 311/312 after `main` took those numbers).
- **Open with Will**: the slice adds one field, `dataTypeId`, to the SQL family's `DefaultResolverColumn` (`packages/2-sql-family/9-family/src/core/migrations/contract-to-schema-ir.ts`), so SQLite can tell `now()` on a `Date` (`date('now')`) from one on a `DateTime`, since every such column is `text`. I told Will and kept it unless he objects; he has not answered.
- Auto-fix could not be turned on: the app says the bot is not the PR's author for its purposes. Watch CI yourself (`watch-pr.sh 30922` from the notes folder, run in the background).
- After the CI-fix commits, re-run: `@internal/sqlite-codec-testkit`, `@internal/postgres-codec-testkit` (its Temporal cases now compare by equality, commit `d57b20666d`), `@internal/language-server`, and from `test/integration`: `pnpm test test/cli-journeys/defaults-read-by-codec.sqlite.e2e.test.ts` (last commit `73a7d96a07`, interrupted before its "can it fail" probe: remove a type from its schema and confirm the list check fails), `test/authoring/sql-target-type-constructors.test.ts`.
- Before the merge queue, run the integration journeys locally (PR CI skips them): `test/integration/test/convenience-date-time-types/*` and `test/cli-journeys/*temporal*`, `*convenience*`. They passed before the CI fixes.
- Once Will approves: auto-merge via the merge queue (`gh pr merge 30922 --repo prisma/orm`, no flag), watch `mergeQueueEntry`, then set TML-3780 Done with a comment.

### Slice 2 details (MySQL) — next work

1. Rebase `tml-3714-mysql` onto the current slice-1 head (`73a7d96a07`); drop its own copy of the type-constructor test fix (`b696372420`, already cherry-picked into slice 1 as `220b9e8018`).
2. Re-run the code review (it was stopped), then fix both reviews' findings. Round-1 design findings to act on: D01 rename `mysql/timestamp@1` to `mysql/timestamp-date@1` (codec ids are recorded in contracts, so before release); D03 literal defaults must refuse digits finer than the column's precision, as PostgreSQL's `refuseFinerThanPrecision` does, and `errorDateTimeUnwritable`'s text overclaims; D04 `now()` for a `Date` column of precision 0–2 must truncate, not let MySQL round up; D05 decide reads of years before 1000; D06 upgrade note: `mysql/datetime@1` now refuses years outside 1000–9999; D07 `Duration` as `text` cannot be indexed: use `varchar` like `String` if `storedAs` allows it, else document; D10 add include/JSON-projection coverage (no MySQL codec testkit exists); D11 a MySQL journey without a global `Temporal`; D12 optional shared `hasDigitsBelow`. D02: keep `TimestampTemporal`, and ADR 315 says it reads `Instant` on MySQL. D08 and D09 are docs and branch hygiene.
3. Write the docs yourself (never delegate docs): ADR 315's MySQL section and its "Not decided here" list, ADR 254's data types and tags, `docs/reference/scalar-types.md` (a MySQL section), the error reference, the `prisma-8` skill, `upgrade-instructions/pending/mysql-convenience-date-time-types/{app,extension}` (temporal-polyfill peer for Yarn, `mysqlCreateNamespace` moved to `/target/types`, the datetime range).
4. Gates: `wip/tml-3714/gates.sh` adapted to MySQL packages, with `MYSQL_URL=mysql://root:root@127.0.0.1:3307/<db>` (`docker compose up -d mysql`; OrbStack must be running). Search for every test that enumerates a target's codecs or tags: slice 1's CI failed on those.
5. Open the PR only after slice 1 is reviewed (Will: no new PRs while the project has unreviewed PRs). Its base is slice 1's branch until slice 1 merges.

### Slice 3 (MongoDB TypeScript builder) — waiting on Will

The design note `specs/slice-3-mongo-ts-type-helpers.design.md` asks two questions, unanswered:
1. What a MongoDB field writes instead of SQL's `field.column(type.X())`. Recommended: `field.scalar(type.Int32())` (Mongo's existing `field.scalar` takes a type instead of a codec id). Alternatives: `field.of(...)` on every family, or `field.column` on Mongo.
2. Where the code that turns type constructors into typed `type.*` helpers lives (today `packages/2-sql-family/2-authoring/contract-ts/src/composed-authoring-helpers.ts`). Recommended: `@internal/contract-authoring` (framework authoring) with the returned shape as a parameter, as the mechanism every family's builder fills in. Alternative: copy it into the Mongo family. Will reacted badly to an earlier framework proposal; explain from scratch, with the example, if you ask again.

Facts already settled for it: Mongo's scalar type constructors must move from the adapter (`packages/3-targets/mongo/2-adapter/src/exports/control.ts`) to the target (ADR 241); the facade's contract builder does not load the adapter today; about 1,000 `field.<helper>()` calls need rewriting (with an upgrade-instruction script); ADR 257's `field.<token>()` sentence gets corrected. A 2026-era project note (`projects/mongodb-contract-ts-support/spec.md:198`) said not to add `type.*` to Mongo without a use case; type choices and aliases are that use case.

### Slice 4 (MongoDB convenience types)

Per the project spec's MongoDB table. Also: the removed-preset row `temporal.timestamp` in `packages/2-mongo-family/2-authoring/contract-psl/src/removed-field-presets.ts:13` must say `DateTime`; about 15 Mongo `.prisma` fixtures and examples use `Date` and must become `DateTime`; the pending `upgrade-instructions/pending/convenience-date-time-types/app` says MongoDB is "not affected" and must change; Prisma 6's `DateTime @db.Date` maps to the calendar `DateString` codec.

## Follow-up tickets filed

TML-3781 (safe-integer checks into the shared package), TML-3782 (decimal text), TML-3783 (plain-JSON check for PostgreSQL and SQLite), TML-3784 (move the framework's ISO date text reader into the shared package), TML-3785 (SQLite `sqlite/datetime` years outside 0000–9999). TML-3780 is slice 1's own ticket.

## Workspace notes

- The original worktree (`/Users/will/Projects/prisma/orm/.claude/worktrees/tml-3714-convenience-types-targets-929d89`) has a second git worktree at `wip/slice1` for slice 1. Both branches are pushed; nothing is uncommitted. Remove `wip/slice1` with `git worktree remove` when done.
- Bash hooks reject the bare package-manager name in command text, and running vitest directly; use `pnpm test <path>` from `test/integration`. Edit files containing that word with Write/Edit, not heredocs.
- Never run the whole integration or packages suite locally; run the files for the change.
