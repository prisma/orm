# Plan: Prisma 8 GA

**Goal:** ship Prisma 8 GA at the end of October 2026. November is the fallback.

This page lists the projects in priority order, by stream. Work the streams in parallel. Inside a stream, work from the top. The reasons behind each decision are in [decisions.md](decisions.md). The pull requests and tickets behind each status are in [evidence.md](evidence.md), one entry per row.

**GA column:** **Must** means GA does not ship without it. **Aim** means wanted at GA, but it can ship just after. **Later** means after GA. **Not decided** means Will has not placed it yet. A project that has started is Must, whatever it was placed as before (Will, 2026-10-16).

**Owner column:** who answers for the row. Streams 1, 2 and 5 are Will's and streams 3 and 4 are Serhii's, except where a row says otherwise (Will, 2026-10-07).

**Progress column:** one symbol, then done/total where the row has countable units. ✅ done · 🟡 code done, waiting on review or docs · 🔄 in progress · ⏳ not started · ❓ needs a decision from Will. The units are the slices, pull requests, tickets or items the Status column names; a row with no units yet has no count.

States were last checked against GitHub and Linear on 2026-10-30.

## How far from GA

Counts the projects marked Must in each stream. A project counts as done only when every part of it has merged. "Not started" includes the one project waiting on a decision. Recount on every refresh.

| Stream | Done | Bar | In progress | Not started |
| --- | --- | --- | --- | --- |
| Foundations and breaking changes | 6 of 8 (75%) | `████████░░` | 2 | 0 |
| Upgrade path from Prisma 7 | 6 of 7 (86%) | `█████████░` | 0 | 1 |
| Editor and tools | 3 of 6 (50%) | `█████░░░░░` | 1 | 2 |
| Query features | 8 of 11 (73%) | `███████░░░` | 1 | 2 |
| Docs and the new user's first hour | 1 of 5 (20%) | `██░░░░░░░░` | 3 | 1 |
| Work found along the way | 1 of 3 (33%) | `███░░░░░░░` | 0 | 2 |
| **All streams** | **25 of 40 (63%)** | `██████░░░░` | **7** | **8** |

## Stream 1: Foundations and breaking changes

**GA readiness:** 6 of 8 Must projects done (75%). 2 in progress, 0 not started.

GA is the last chance to make breaking changes, so this stream decides the date.

| # | Progress | Project | GA | Owner | Status | Next |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | ✅ 6/6 | Finish ADR 254: data types own column types | Must | Will | Done 2026-10-20. The cast rule (TML-3389) merged last. Bugs found along the way stay in the project's backlog |  |
| 2 | ✅ 2/2 | One CLI and one config file | Must | Will | Done 2026-10-08 |  |
| 3 | 🔄 4/6 | Early MySQL attempt, to find shared code that assumes PostgreSQL | Must | Will | 6 slices. Merged 2026-10-22: every database's packages in one folder, and a MySQL target that emits a contract and reads a MySQL database's structure. MySQL migrations, `db verify` and `db sign` merged 2026-10-23. ORM reads merged 2026-10-28. Both MySQL drivers moved onto the `mariadb` package, with every value sent in a prepared statement, merged 2026-10-29. Left: ORM writes without `RETURNING` (TML-3696), MariaDB (TML-3697) | Build TML-3696 |
| 4 | ✅ 6/6 | SQL expression literals | Must | Will | Done 2026-10-12 |  |
| 5 | ✅ 5/5 | PSL mixins, then remove field presets; generated values become `@onCreate` and `@onUpdate`, and type aliases become an authoring shorthand | Must | Serhii (mixins), Will (TML-3607) | Done 2026-10-27. Mixins done 2026-10-14. ADR 275 merged 2026-10-19. TML-3607's 3 slices merged 2026-10-20, 2026-10-22 and 2026-10-27; the last removed field presets |  |
| 6 | ✅ 1/1 | Remove `@noCheck` and `.noCheck()` | Must | Will | Done 2026-10-16 |  |
| 7 | 🔄 5/7 | Migration statements: the planner refuses data loss, the user states renames, deletes, conversions and backfills | Must | Will | 5 of 7 slices merged. The TypeScript MongoDB validator slice merged 2026-10-20, with a MongoDB field keeping its own name in code. Left: the rest of TML-3537 (enum values, value object fields and variants on Postgres and SQLite), and convert and backfill on MongoDB (TML-3538, backlog). TML-3537's first PR, renames, moves and deletes of Postgres namespaces, merged 2026-10-22. Its second, renames and deletes of enum values, merged 2026-10-23. Its third, value object fields and variants, merged 2026-10-28. TML-3537 is still In Progress in Linear; what is left in it is not checked | Check what is left in TML-3537, then TML-3538 |
| 8 | ✅ 4/4 | Client surfaces: a client takes a typed contract value, custom collections on every client and transaction | Must | Will | Slice 1 merged 2026-10-19; it is breaking: `postgres<Contract>({ contractJson })` became `postgres({ contract: contractFromJson<Contract>(json) })`. Slice 2, custom collections on every SQL client, merged 2026-10-20. Slice 3, a transaction offers the client's query members, merged 2026-10-20. Slice 4, a client loads without a database and renders plans as SQL, merged 2026-10-21. Done 2026-10-21 (Will). The close-out merged 2026-10-21 |  |

## Stream 2: Upgrade path from Prisma 7

**GA readiness:** 6 of 7 Must projects done (86%). 0 in progress, 1 not started.

Test: an existing Prisma 7 database can be signed by Prisma 8.

| # | Progress | Project | GA | Owner | Status | Next |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | ✅ 9/9 | Close every urgent and high issue in the Prisma 7 contract source | Must | Will | Done. The "Prisma 7 contract source: gaps and defects" project has no open Urgent or High issue (checked 2026-10-29). The two `contract print` issues, TML-3323 and TML-3326, were counted here by mistake and moved to stream 6 |  |
| 2 | ✅ 7/7 | Prisma 8 owns migrations in a Prisma 7 project that still reads `schema.prisma` | Must | Will | Done 2026-10-29. The last gap, the datasource's extensions list (TML-3460), merged 2026-10-29: contracts declare Postgres extensions, packs declare theirs, and `db sign` adopts databases that use pgvector, PostGIS or ParadeDB |  |
| 3 | ✅ 7/7 | Storage a model does not map: a table may hold columns its model does not map, and a table may have no model | Must | Will | Done 2026-10-13: 4 slices, ADR 267, the fix for a model with no fields, and the close-out merged |  |
| 4 | ⏳ | Upgrade guide rewrite | Must | Will | Ticket in backlog. One known error in the guide |  |
| 5 | ✅ 6/6 | Codecs for `citext`, `bit`, `varbit`, `xml`, `oid`, `money` | Must | Will | Done 2026-10-30. `bit`, `varbit`, `xml`, `oid` and `money` merged 2026-10-29. `citext`, as a new extension pack, merged 2026-10-30 |  |
| 6 | ✅ 3/3 | Columns whose type has no codec | Must | Will | Done 2026-10-21 (Will). ADR 273: such a column is a raw column, `Raw("...")` in a Prisma 8 schema, and a Prisma 7 `Unsupported(...)` field is read as one. The close-out merged 2026-10-21 |  |
| 7 | ✅ | Adopt a Prisma 7 database without changing it: the enum membership check | Must | Will | Done. The Prisma 7 reader reads enums as native Postgres enums, which get no derived CHECK constraint (ADR 157 amendments, ADR 286). So `db sign` and `db verify` accept the database Prisma 7 built, enums included. The CLI journeys `prisma7-source` and `native-enum-adoption` cover it |  |
| 8 | ⏳ | Medium and low upgrade issues | Later | Will | Backlog | |
| 9 | — | `money` codec | Later | Will | Moved into row 5 on 2026-10-27 | |
| 10 | ⏳ | Views | Later | Will | Backlog | |
| 11 | ⏳ | Prisma 8 syntax for columns and tables no model maps, so `contract print` can convert a Prisma 7 schema that uses `@ignore` | Later | Will | TML-3469, backlog. Needs a syntax design | |

## Stream 3: Editor and tools

**GA readiness:** 3 of 6 Must projects done (50%). 1 in progress, 2 not started.

| # | Progress | Project | GA | Owner | Status | Next |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | ✅ 5/5 | Emulator controls in the `prisma` CLI: start, stop, list, reset | Must, urgent | Will | Done 2026-10-21. `prisma dev --detach`, `prisma dev stop`, `prisma dev url` and `prisma emulator list` ship in `prisma@8.0.0-rc.24`, and the docs slice merged. Reset was not built | Decide whether reset is still needed |
| 1b | ⏳ | A Prisma Studio command in the `prisma` CLI | Must, urgent | Serhii | Not started, no ticket. Prisma 8's `prisma` has no Studio command; Prisma 7's `prisma studio` has no replacement |  |
| 2 | 🔄 2/4 | VS Code extension: formatter without the CLI, go-to-definition, multi-file PSL, emulator controls | Must | Serhii | Go-to-definition and multi-file PSL done. Rename merged. File watching approved, not merged; a fix to removing a file watcher merged 2026-10-20. Formatter without the CLI unverified. Emulator controls wait on row 1 | Merge the file-watching PR. Verify the formatter works without the CLI |
| 3 | ⏳ | Make the extension's handling of local and remote Prisma Postgres match the CLI and its emulators | Must | Serhii | Not started |  |
| 4 | ✅ 1/1 | Multi-file PSL | Must | Serhii | Done 2026-09-30 | |
| 5 | ✅ 1/1 | Several `types` blocks in a schema, so type aliases can sit beside the models that use them | Must | Serhii | Done 2026-10-16. It already worked; a PR added the tests and docs |  |

## Stream 4: Query features

**GA readiness:** 8 of 11 Must projects done (73%). 1 in progress, 2 not started.

Everything here is additive, so nothing here can block a breaking change.

| # | Progress | Project | GA | Owner | Status | Next |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | ⏳ | Transaction options: isolation levels and timeouts | Must | Serhii | Not designed. A stale draft exists |  |
| 1b | ⏳ | Nested transactions | Must | Serhii | Not designed |  |
| 2 | 🔄 0/5 | Nested writes on relations: `update`, `delete`, `upsert`, `set`, `connectOrCreate` | Must | Serhii | Every top-level write runs through one mutation graph. A PR moving nested writes onto it, and removing the old executor, is in review. Slice 1 (`update` and `delete` on a filtered set) in review since 2026-10-09 | Review the slice 1 PR |
| 3 | ✅ 1/1 | Design the replacement for `omit` | Must (design only) | Will | Design done (Will, 2026-10-07) |  |
| 4 | ⏳ | Expressions in updates (what `increment` and `decrement` did in Prisma 7) | When there is time | Serhii | Not designed | |
| 5 | ✅ 1/1 | A query that fails when nothing matches (what `firstOrThrow` did in Prisma 7) | Must | Serhii | `firstOrThrow` on collections merged 2026-10-08 |  |
| 6 | ⏳ | JSON filters and list filters | Later | Serhii | PR stalled since July | |
| 7 | ✅ 5/5 | Middleware sees a tree of activities | Must | Will | Done 2026-10-20. Slice 4 and the close-out merged together | |
| 8 | ✅ 4/4 | Cache middleware | Must | Will | Done 2026-10-20. Invalidation after commit merged with row 7's slice 4 | |
| 9 | ✅ 3/3 | Row locking on a select | Must | Will | Done 2026-10-07 | |
| 10 | ✅ 4/4 | Collection classes, query fragments and indexes | Must | Will | Done 2026-10-15. Closed out 2026-10-16 | |
| 11 | ✅ 1/1 | `variant()` selects by discriminator value | Must | Serhii | Merged 2026-10-06 | |
| 12 | ✅ 1/1 | The Postgres driver returns every column as text | Must | Will | Merged 2026-10-06 | |


## Stream 5: Docs and the new user's first hour

**GA readiness:** 1 of 5 Must projects done (20%). 3 in progress, 1 not started.

Test: the getting-started eval passes, in few steps and with no workarounds.

| # | Progress | Project | GA | Owner | Status | Next |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | ✅ 2/2 | Docs and the shipped skill stop naming `prisma-composer` | Must, urgent | Will | Done 2026-10-08 |  |
| 2 | 🔄 0/3 | Correct the query reference in the shipped skill, which promises features that do not exist | Must, urgent | Will | 1 PR approved, 1 PR open, 3 tickets open | Merge the approved data-transforms PR, then review the back-references PR |
| 3 | 🔄 1/11 | Docs gaps found by the eval: 11 items, 5 high | Must | Will | 1 of 11 merged. The rest not re-checked | Re-check the 11 items against prisma/web |
| 4 | ❓ | ORM scenario for the eval: decide the project, then build it | Must | Will | Not decided | Decide the project |
| 5 | 🔄 | Docs restructure | Must | Will | The docs audit draft is active again, updated 2026-10-22. Three new pages merged 2026-10-23: a database on your machine, Advanced PostgreSQL, and supported versions. More merged 2026-10-29: Types for your code, Money and decimals, a Vercel deployment guide, and extension pages. The rc.21 docs update has changes requested | |
| 6 | ⏳ | Document that cursor pagination starts after the cursor row | Aim | Will | Not tracked | |
| 7 | ⏳ | Update the records that contradict the code | Aim | Will | Not started |  |

## Stream 6: Work found along the way

**GA readiness:** 1 of 3 Must projects done (33%). 0 in progress, 2 not started.

Work found after the plan was made goes here, so the first five streams keep the scope they started with (Will, 2026-10-21).

| # | Progress | Project | GA | Owner | Status | Next |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | ⏳ | Remove the `unbound` / `__unbound__` namespace alias, keeping one name | Not decided | Serhii | Serhii proposed it in a docs PR to the RC plan, not merged. Not started | |
| 1b | ⏳ | `contract print` writes a relation into another contract space (TML-3326), and an extension pack says how its entity kind is printed (TML-3323, needs an ADR first) | Not decided | Will | Backlog. Moved from stream 2 row 1 on 2026-10-29 | |
| 2 | ⏳ | Shrink the generated contract files, so a PR's line count shows the change and not the regenerated `contract.d.ts` and `contract.json` | Must | Will | Not started, no ticket. Migration snapshots in every user's `migrations/` folder hold both files. Possibly minify them or strip whitespace (Will, 2026-10-21) |  |
| 3 | ✅ 6/6 | Date and time usability: `DateTime`, `Date`, `Time` and `Duration` convenience types over the explicit database types; string codecs return ISO strings; a Prisma 7 `@default(now())` keeps filling the value on create | Must | Will | Started 2026-10-21. The design (ADR 279) and slices TML-3418, TML-3711, TML-3713 and TML-3719 merged 2026-10-23. TML-3710 was cancelled. The convenience types (TML-3712) merged 2026-10-28. Done 2026-10-29; the close-out merged that day |  |
| 4 | ⏳ | Maturity per package: design the policy and document it publicly. The framework and each database package have their own maturity level, and a package's public API is its public exports | Must | Will | Decided 2026-10-30. Not started. The design decides how a package's version number relates to its maturity, since every package shares one version today. The docs to update: `docs/oss/versioning.md`, and in prisma/web `orm/release-status.mdx` and `orm/supported-databases.mdx` |  |

## Databases

| Database | At GA |
| --- | --- |
| Framework (ORM core) | Release candidate today. Its own maturity level since 2026-10-30 |
| PostgreSQL | Ready |
| SQLite, MongoDB, MySQL/MariaDB | Can finish after GA. Labelled release candidate or early access until ready. They start once stream 1 has stopped changing what targets build on. |

Outside the streams: MongoDB contracts written in TypeScript, PSL or Prisma 6 build through one builder (TML-3616), merged 2026-10-23; its close-out merged 2026-10-28. Follow-ups to client surfaces (row 8 of stream 1), all merged: a Supabase client shuts down like a Postgres client (prisma/orm#30828, 2026-10-22); a closed client's members reject instead of throwing at the call (prisma/orm#30840, 2026-10-23); MongoDB queries take an execution context like SQL queries (TML-3686, prisma/orm#30865, 2026-10-29); `mongo()` creates its driver from the execution stack like `postgres()` (TML-3763, prisma/orm#30906, 2026-10-30). Plans for ORM writes (TML-3684) cancelled 2026-10-30 (Will): no user need. Left in the backlog until a user asks: TML-3682 (Supabase cannot stream large reads) and TML-3683 (MongoDB has no `prepare` or `extensions`).

## Beside the streams

| Progress | Item | Owner | Status | Priority |
| --- | --- | --- | --- | --- |
| ✅ | Manifesto | Will | Published | |
| 🔄 | One lowering for PSL and the TypeScript contract builder | Serhii | Serhii and WhyAsh (prisma-idb) | Not a GA item unless Will says so |
| 🔄 | Asks | Will | Ongoing | Lower, in parallel with GA |
| 🔄 | Eval harness | Will | Ongoing | Lower, in parallel with GA |
| ⏳ | Platform faults found by the eval | Will, as platform lead | Not started | Not an ORM priority unless they delay GA |

## After GA

Query linting, querying across contract spaces, performance work, migration runner service, the BetterAuth flow, referential actions on MongoDB. `@hint(was: oldName)` was listed here; migration statements replace it (stream 1, row 7).

## Never

`$extends`, the fluent relation API, `P2002`-style error codes, `Prisma.skip`, `omit` under that name, automatic batching, relation load strategy, `relationMode = "prisma"`, splitting large `IN` lists, soft delete, validation rules, lifecycle hooks, read replicas.
