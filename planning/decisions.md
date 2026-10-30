# Decisions behind the plan

Planning notes on the branch `planning/prisma-8-ga`. Not for merging into `main`.

This file records every decision Will made in the planning discussion of 2026-09-28 and 2026-09-29, with reasons. The priority order of the work is in [plan.md](plan.md). The inventory behind it is in [open-projects.md](open-projects.md) and [eval-friction-2026-09-28.md](eval-friction-2026-09-28.md).

## Goal

Ship Prisma 8 GA at the end of October 2026. November is the fallback. If October is missed, Will announces the new date when that happens.

The public docs already state these commitments (page "Release status" in `prisma/web`, read 2026-09-29):

- General availability is expected in October 2026.
- Prisma ORM 7 gets bug fixes and security updates for 18 months from the day of GA.
- `npm install prisma` installs Prisma 8 today, so existing Prisma 7 users already meet it.

## Team

Will Madden and Serhii. Agents write all the code. Will takes the contract, migrations, targets and the upgrade path. Serhii takes language tools and the query side.

## Who it is for

The target user is new to Prisma, in a new project, building with AI.

Existing Prisma 7 users must be able to upgrade. They reacted badly to the release candidate because the upgrade path was missing. Prisma 8 does not copy the Prisma 7 query API. Users run the Prisma 7 client beside the Prisma 8 client.

## Rules for ordering work

1. Breaking changes come as early as possible. GA is the last chance to make them.
2. Changes that database targets build on come before new targets.
3. Additive features can follow GA.

## Tests for GA

1. **Upgrade:** Prisma 8 can describe every database feature Prisma 7 could describe, so an existing database can be signed. Which gaps to leave is Will's judgment.
2. **New user:** the getting-started eval passes. Starting a project takes few steps and needs no workarounds. The eval needs an ORM scenario without a deploy, run against every database. The project it builds is not decided.

## Streams

1. Foundations and breaking changes: the critical path below.
2. Upgrade path: Prisma 7 schema gaps, follow-ups to the migration handover, upgrade guide. No baseline command is needed (2026-10-05, see context.md).
3. Editor and tools: VS Code extension, multi-file PSL, emulator controls.
4. Query features. The stream exists whether or not each feature in it is required for GA. Which features are required is not decided.

## Tasks to decide or fix before GA

| Task | Why |
| --- | --- |
| Document cursor pagination | Settled 2026-09-29: Prisma 8 starts after the cursor row on purpose, confirmed by the team. Prisma 7 includes the cursor row. The docs do not mention the difference yet. The 13 ported tests that fail on it are expected to fail. |
| Remove `@noCheck`, `.noCheck()` and the `noCheck` field in the contract | Will, 2026-09-29: it was a workaround and must go. It is breaking, so it happens before GA. Facts (read on `main`): ADR 244 defines it. It has two kinds. `elementNotNull` waives the check that list elements are not null, and the Prisma 7 source sets it on every list column. `membership` waives the check that a value belongs to its enum. Replacements, decided by Will on 2026-09-29. For lists: finish prisma/orm#30051, so the contract can state that list elements may be null. For enums: no opt-out. Prisma 8 adds the membership constraint to the database. Will, 2026-10-15: a Prisma 7 `String[]` is read as nullable elements, because a Prisma 7 schema must pass `db verify` under Prisma 8 with no migration; `contract infer` writes `String?[]` for a list column with no element check. Shipped in prisma/orm#30741 (TML-3595) on 2026-10-16. |
| Correct the query reference in the agent skill (`skills/prisma-8/references/queries-postgres.md`) | Urgent, same kind of fault as TML-3340. It sends users to `db.sql` for set operations and window functions, and neither exists. `prisma init` copies the skill into every new project. |
| Correct the other documents that contradict the code | Listed in [query-feature-gaps.md](query-feature-gaps.md). |
| Decide what project the ORM scenario of the eval builds, then build the scenario | It is the GA test for the new user. It runs without a deploy, against every database. |
| Design how a query leaves fields out, the Prisma 8 replacement for `omit` | Design work. If it is not built by GA, a clear plan must exist. |
| Large `IN` lists: not a task (Will, 2026-09-30) | In Prisma 7 the problem came from joining in memory. Prisma 8 joins in the database, so it does not create large `IN` lists itself. Earlier text: Prisma 8 does not split them, and will not. On PostgreSQL an oversized query drops the connection today. Lowest priority on this list. |

## After the plan is finished

Fix `contract infer` printing `Unsupported(...)`. (The `pg/opaque` codec was removed from the spec's deferred list in prisma/orm#30449.)

Update every record that contradicts the code. Known so far: the non-portable and failing test records under `test/integration/test/ports/`, and the documents listed in [query-feature-gaps.md](query-feature-gaps.md). Four stale records found so far: nulls ordering, full-text search, raw SQL, comparing two columns.

## Principles

1. Prisma 8 does not build implicit behavior that the user did not ask for. Automatic batching of lookups is the example.
2. Every design accounts for all four databases, even when only PostgreSQL ships the feature at GA. Take this as given. Do not ask Will to confirm it.
3. Everything Prisma 8 manages can be verified against the database. Reopened 2026-09-30: a column Prisma 8 does not manage may be declared with control policy `external`, possibly with an unknown type. See the upgrade path section.
4. The Prisma 7 contract source describes a database. It does not commit Prisma 8 to reproducing Prisma 7 query behavior.

## Upgrade path: what Prisma 8 must describe

| Prisma 7 feature | Decision |
| --- | --- |
| Views | After GA. They are a preview feature in Prisma 7. |
| Native types with no codec: `citext`, `bit`, `varbit`, `xml`, `oid` | Add codecs (TML-3270). |
| `money` | Can get a codec. Low priority: the PostgreSQL `money` type is considered bad practice. |
| `Unsupported("...")` columns | Reopened 2026-09-30 after a discussion with Serhii: Prisma 7 contracts need a way to state such columns, and legacy columns need a way to be managed outside Prisma 8. Proposal: `@control(external)` on the column, with an `unknown` type when no codec fits. Decided in part on 2026-10-07: a column no field maps is declared as storage and carries a control policy, so a legacy column managed outside Prisma 8 is covered by ADR 267 (stream 2, row 3). The `unknown` type for a column with no codec is still not decided (row 6). The earlier decision follows. Never. A column the contract cannot describe cannot be verified. TML-3271 is canceled. A column type Prisma 8 cannot describe needs a codec. |
| `relationMode = "prisma"` | Never. Prisma 8 will not imitate foreign keys in the client. The upgrade guide tells those users to add foreign keys. |
| Referential actions on MongoDB | After GA. |

Adopting a Prisma 7 database must not require a database change before cutover, and must not weaken what signing guarantees. Rejected on 2026-09-30: marking the contract as not managed during side-by-side running, so that no derived CHECK constraints are expected. Will: it compromises the guarantees that signing makes, and a user may well move to Prisma 8 migrations while still running Prisma 7 queries. The task stays open in the plan.

Superseded if the external-column proposal is adopted: when `contract infer` or the Prisma 7 source meets a column type with no codec, it fails and names the column and the missing codec. It does not leave the column out. Today `contract infer` prints `Unsupported(...)` instead, which must change.

Stopping point for the open upgrade issues: every urgent and high issue is closed before GA. Medium and low issues may remain. The issues are in two Linear projects: "Prisma 7 contract source: gaps and defects" and "Contract print and Prisma 7 source follow-ups".

## Emulator controls in the `prisma` CLI: start now

Will, 2026-09-30: the emulator controls (start, stop, list, reset) are now urgent and start immediately. They were already required for GA; what changed is the order. They move to the top of the editor and tools stream. The VS Code extension work that depends on them (items 2 and 3 of that stream) waits on them. Background from 2026-09-28: several emulators of each type can run, so status is a list; the eval found that stopping `prisma dev` leaves the emulator processes running and no stop or cleanup command exists.

## Changes of 2026-10-30

- Maturity is set per package, not for Prisma 8 as a whole (Will). The ORM core, the framework, has its own maturity level: release candidate today. Each database target package has its own level: PostgreSQL is release candidate, MongoDB is early access, and so on. A package's public API is its public exports. Apps and extension authors use the same exports, so one rule covers both. Reason: each database can launch on its own date, and the community can be asked to help build the remaining targets. That invitation need not be documented now, but the public pages must set the expectation.
- Designing the policy and documenting it publicly is a task in this plan, with the existing definitions updated to match (Will). Stream 6, row 4. Questions such as version numbers are settled in that design, not now.
- ORM writes do not get plans (Will). TML-3684, which would let `db.toSql` show the SQL of an ORM `create`, `update` or `delete`, is cancelled. Reason: no user asked for it, `db.sql` already gives plans for writes, and tests can run a write in a transaction instead. Reopen if a user asks.

## Changes of 2026-10-23

- Date and time usability is a GA project (Will). It started on 2026-10-21, so it is Must. Stream 6, row 3.

## Changes of 2026-10-21

- New work found after the plan was made goes into its own stream, "Work found along the way" (stream 6), not into the stream it belongs to (Will). Reason: the first five streams kept growing as work was found, so their progress looked like it went backwards. The `unbound` alias and shrinking the generated contract files moved there from stream 1.
- Prisma 8 needs a Prisma Studio command in the `prisma` CLI before GA, as soon as possible (Will). Stream 3, row 1b, Must and urgent. Checked 2026-10-21: no Studio command exists in prisma/orm, prisma/prisma-cli or prisma/composer, and there is no PR or Linear ticket for one.
- The generated contract files must shrink before GA (Will). `contract.d.ts` and `contract.json` are regenerated into fixtures and migration snapshots across the repo, and they make small PRs show tens of thousands of changed lines. Will's first idea is to minify them or strip whitespace; the approach is not decided. Must. It changes what `migration plan` writes into a user's project, so it must land before GA. Now stream 6, row 2.

## Changes of 2026-10-16

- A project that has started is Must (Will). It counts toward GA readiness. Nested writes, the `firstOrThrow` need and the docs restructure became Must. The six unranked projects in stream 4 became ranked Must rows 7 to 12. The items beside the streams (manifesto, one lowering, Asks, eval harness) are not GA projects and are not counted.
- A schema may hold several `types` blocks (Will and Serhii). Stream 3, row 5. It already worked; tests landed on 2026-10-16.
- Field presets are removed, and type aliases stay (Will and Serhii). This changes TML-3055's decision of 2026-07-20, which removed both. The work is TML-3607, and it is the rest of stream 1 row 5. A value the client generates is written `@onCreate(fn())` or `@onUpdate(fn())`, and `fn` resolves to the generator for the column's codec. `@default` means a database default only, so `@default(uuid())` becomes `@onCreate(uuid())`. A type alias is an authoring shorthand: PSL expands it into each column, the contract does not store it, and it may carry `@default`, `@onCreate` and `@onUpdate`. Types that exist in the database, such as native enums, stay in the contract. Targets and extensions contribute aliases instead of presets. Reason: one mechanism that users and packages share, and printed Prisma 7 schemas read like the source, for example `updatedAt TimestampString(3) @onCreate(now()) @onUpdate(now())` instead of `temporal.timestampString(3, onCreate: now, onUpdate: now)`.
- TML-3607 is built by Will's stream, not Serhii's (Will, 2026-10-16). Serhii keeps the mixins half of row 5, which is done. Order: the ADR first, for Will and Serhii to review; then the Prisma 7 migrations PR (TML-3457) while it is reviewed; then TML-3607.

## Changes of 2026-10-07

- Ownership by stream (Will): streams 1, 2 and 5 are Will's; streams 3 and 4 are Serhii's. Exceptions: PSL mixins is Serhii's; the emulator controls in the `prisma` CLI, the `omit` replacement design, row locking on a select, collection classes and scopes, the Postgres driver returning every column as text, and the cache middleware are Will's.
- The design of the replacement for `omit` (stream 4, row 3) is done.
- Storage a model does not map (stream 2, row 3) is designed and started. Will and the agent settled it in discussion: a model maps to a table that may hold columns the model does not map, and a table may have no model; such storage is declared in storage terms, with `columns` in a model's `.sql({ ... })` and a `table(...)` declaration beside models, and Prisma 8 PSL gets `sql { }` and `table` blocks as parity twins later. The one lowering, `buildSqlContractFromDefinition`, splits into derive and assemble, and storage declared as storage enters at assemble. The ORM projects per model and refuses any name that is not a field. Recorded as ADR 267 in design PR prisma/orm#30641. The earlier "unexposed storage" design, which put a hidden flag on field and model nodes, is withdrawn; its implementation PR is closed and the parts that survive (the ORM projection, the non-field refusal, the validators, the `{}` typing) are reused in slice 1.
- Row 6 narrows to the `unknown` type. The column-level control policy it proposed is part of row 3.
  - Update 2026-10-13: row 3 did not build a column-level control policy. ADR 267 gives a column its table's policy, so the column-level policy is back with row 6.
- The Prisma 7 path needs no Prisma 8 PSL syntax: the Prisma 7 reader lowers `@ignore` and `@@ignore` into storage directly. The PSL blocks and the TypeScript `columns` and `table(...)` surfaces follow, under the parity rule of ADR 096.
- Compiling the PSL interpreter to the TypeScript DSL's input, as WhyAsh's spike did for the IDB family, is a good future direction and not part of this project. The derive-and-assemble split is a step toward it.

## Changes of 2026-10-05

- Serhii takes PSL mixins (stream 1, item 5).
- Will takes the emulator controls in the `prisma` CLI (stream 3, item 1).
- Serhii takes over the discussion with WhyAsh of prisma-idb about one lowering for PSL and the TypeScript contract builder. WhyAsh's spike translates PSL into `defineContract` input so both authoring surfaces run through one implementation, and reports identical contracts with about 40% less code. Links are in plan.md, under "Beside the streams".
- The transactions project is split in two. "Transaction options: isolation levels and timeouts" is one project. "Nested transactions" is a separate project. Both keep the Must rating the combined project had until Will says otherwise.

## Query features: required for GA

Transaction options: isolation levels and timeouts, and, as a separate project since 2026-10-05, transactions inside transactions. None exists today. The runtime docs mark them as deferred. The databases differ here (SQLite has no isolation levels, MongoDB has its own transaction model), so the design lets each database state what it supports.

## Query features: build when there is time

The needs that `increment`, `decrement` and `firstOrThrow` met in Prisma 7. Prisma 8 need not copy their API (Will, 2026-09-30). Expressions in updates meet the first two. `firstOrThrow` is a separate need. Serhii's plan for it is a new collection method, `whereUnique()`. That design is his, not part of this planning discussion.

## Query features: high priority

Nested writes on relations: `update`, `delete`, `upsert`, `set` and `connectOrCreate`. Only `create`, `connect` and `disconnect` exist on SQL today. Traversing relations is one of the main reasons to use an ORM. Earlier work deferred this to TML-2781. They are additive, so they can ship just after GA if they are not ready.

## Query features: decided

| Feature | Decision |
| --- | --- |
| `$extends` | Never. Middleware replaces it. |
| Fluent relation API (`findUnique().posts()`) | Never. It belongs to the Prisma 7 query style. |
| `P2002`-style error codes | Never. Prisma 8 error codes are better. |
| `Prisma.skip` | Never. It only made sense for Prisma 7's object-style queries. |
| `omit` | Never under that name. Prisma 8 gets its own way to leave fields out. Not designed yet. |
| Soft delete, validation rules, lifecycle hooks, read replicas | Not planned. |
| MongoDB referential actions | Not for GA. |
| Comparing two columns in `where` | Already exists. The record that says otherwise is out of date. |
| Automatic batching of single-row lookups | Never. See the principle above. |
| Relation load strategy | Never. Prisma 7 had it because it first joined in memory and added database joins later. Prisma 8 always lets the database join. |

## Query features: not decided

- JSON filters and list filters. Proposed for after GA unless simple.

## Feature status at GA

Row-level security, expression indexes, partial indexes and `@@control` are fully supported at GA, not preview.

## Input not yet decided

From another conversation, 2026-09-28:

- Build `increment`, `decrement` and `firstOrThrow`. None is in the ORM client today.
- JSON filters and list filters: after GA, unless they are simple to build with field operators. prisma/orm#29834 (list operations) has been open since 2026-07-28 with merge conflicts.
- Not planned: soft delete, validations, lifecycle callbacks, read replicas.
- MongoDB referential actions are not for GA (TML-3339). Document deleting children first.

## Databases

All four at GA: PostgreSQL, SQLite, MySQL/MariaDB, MongoDB. No MySQL target exists in the repo today.

PostgreSQL must be ready at GA. The other databases can finish after the GA launch, as long as they are visibly on the way. Until each is ready it is labelled release candidate or early access.

Since 2026-10-30 that label belongs to each database's package, and the framework has its own (see "Changes of 2026-10-30").

## Required before GA, in order

| Order | Work | State on 2026-09-28 |
| --- | --- | --- |
| 1 | Finish ADR 254, Linear project "Data types own column types" | Design in progress on branch `data-types-completion`. 3 of 16 questions settled. No spec yet. 4 of 9 parts of the ADR are built. |
| 2 | One CLI and one config file | See below. |
| 3 | Early MySQL attempt | Not started. Purpose: find shared code that assumes PostgreSQL. |
| 4 | SQL expression literals. Required, because row-level security, expression indexes and partial indexes are fully supported at GA and their syntax must be final. | 6 tickets in backlog. Blocked, see below. |
| 5 | PSL mixins (TML-3055), then remove field presets (TML-3607). Type aliases stay, as an authoring shorthand (2026-10-16). | Mixins done 2026-10-14. Removing presets: decided, no ADR yet. Large. |
| In parallel | Upgrade path: Prisma 7 schema gaps, upgrade guide rewrite. The baseline command listed here on 2026-09-28 is not needed (2026-10-05, see context.md). | Will is working on it now. |
| In parallel | Docs items from the eval | 11 items, 5 high. Owned by the team. |
| In parallel | Multi-file PSL | 2 of 3 parts merged. Language server part open in prisma/orm#30456. |
| In parallel, Serhii | VS Code extension | Critical. Serhii is working on it. No Linear project found. Must have at GA: the formatter works without the `prisma` CLI installed, go-to-definition into PSL, multi-file PSL support, integration with the `prisma` emulator controls. |
| Not ordered yet | Emulator controls in the `prisma` CLI: start, stop, list, reset. Several emulators of each type can run, so status is a list. | Not tracked. The VS Code extension depends on it. The eval found that stopping `prisma dev` leaves the emulator processes running and that no stop or cleanup command exists. |
| Not ordered yet | "Contract print and Prisma 7 source follow-ups" | Linear project created 2026-09-28. 18 issues, all backlog, 3 high (TML-3322, 3323, 3326). |

## One CLI and one config file

This is part of the strategy, not a single ticket.

- `prisma` is the only CLI anyone is told to use.
- `prisma.config.ts` is the only config file. Composer's configuration moves out of `prisma-composer.config.ts`. Today the `composer` section holds only a path to that file.
- The standalone `prisma-composer` CLI is removed.

Tracked so far: TML-3340 (docs and the shipped skill name `prisma-composer`). Not yet tracked: the config merge, removing the standalone CLI, adding `destroy` to `prisma`.

## Blockers

| Blocker | What it blocks | State |
| --- | --- | --- |
| Pull request prisma/orm#30381, "Generic block values bind the shared typed expression grammar" | The whole "SQL expression literals" project, starting with TML-3296 and TML-3288. Also question 9 of the data types design. | Open since 2026-09-22. Review required. Merge conflicts with `main`. Serhii hopes to merge it on 2026-09-28. |
| ADR 254 remaining work | MySQL/MariaDB and any other new target | See order 1. |
| Platform faults (crash loops, 502 responses, Management API errors) | The eval passing on the deploy scenario | Will handles these as platform lead. They are not ORM priorities unless they delay GA. |

## After GA

- `@hint(was: oldName)`. High user value, additive.
- Migration runner service. Optional.
- Query linting.
- Querying across contract spaces. Optional, but a competitive advantage.
- Performance work.
- The BetterAuth flow.
- Prisma 8 syntax for columns and tables no model maps (TML-3469), stream 2 row 11. Until then, `contract print` refuses a Prisma 7 schema that uses `@ignore`, and such a project keeps its Prisma 7 schema as the contract source (Will, 2026-10-13).
- Stream 2 row 1 covers issues in the Prisma 7 contract source only. The `contract print` issues TML-3323 and TML-3326 do not belong there; they sit in stream 6, not placed (Will, 2026-10-29).
- TML-3772, a pack's extension installed outside `public` (as Supabase installs `vector`), is not a GA concern (Will, 2026-10-29: "I don't care about this problem").

## Lower priority, handled by Will in parallel

- Asks.
- The getting-started eval harness.

## This week

- Publish the manifesto on 2026-09-28 or 2026-09-29. Pull request prisma/prisma-orm-messaging#17.

## Already done

- Package consolidation. Internal packages are no longer published.
- `@db.*` attributes are removed.

## Open questions

1. Which of the 18 follow-up issues are required for GA? The stopping point (urgent and high closed) answers this unless Will says otherwise.

Settled: mixins shaping starts soon and builds on ADR 254; ADR numbering is fixed.
