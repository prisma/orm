# Prisma's own database tables: plan

The design is in [design.md](design.md), with what building it has changed in [amendments.md](amendments.md). Linear: [TML-3978](https://linear.app/prisma-company/issue/TML-3978).

**Purpose.** After this project no upgrade within Prisma 8 fails because of the tables Prisma keeps for itself in a user's database, and every name Prisma owns there is one we can keep for all of Prisma 8. It must merge before `8.0.0`.

**Done means.** A database created by the last release candidate is brought to the new tables with no manual step, shown by a test against a real PostgreSQL database. A fresh database gets the new names. No "marker" remains where a user or a tool can see it. Each other target is done or has a ticket that stands alone. Prisma Studio reads the new names.

Seven slices, one pull request each, in this order. PostgreSQL comes first because it is the only target that is generally available at `8.0.0`.

| Slice | State |
| --- | --- |
| 1. PostgreSQL: the `_prisma` contract space, applied first, and the schema rename | Merged in [prisma/orm#31234](https://github.com/prisma/orm/pull/31234), together with slice 2, after prisma/orm#31203 |
| 2. PostgreSQL: split the marker into signatures and configuration | Merged into slice 1's branch by [prisma/orm#31242](https://github.com/prisma/orm/pull/31242), and into `main` with it |
| 3. Commands read the policies from the database's configuration | Not started. Design with the operator first |
| 4. Rename the concept from "marker" to "signature" | Not started |
| 5. SQLite, MySQL, MariaDB and MongoDB | Not started |
| 6. Prisma Studio reads the new names | [prisma/studio#1606](https://github.com/prisma/studio/pull/1606) merged on 2026-11-27 and released in Studio 0.36.0. Console (`prisma/pdp-control-plane`) then needs that Studio release |
| 7. Decide whether PostgreSQL's contract table becomes a documented feature | Not started |

## Slice 1. PostgreSQL: the `_prisma` contract space, applied first, and the schema rename

**Outcome.** The PostgreSQL target package carries a contract space named `_prisma`: a contract for Prisma's own tables and a first migration, authored the way pgvector's are. Commands that change a database bring this space up to date before they read anything else. The schema is named `_prisma`; a database with `prisma_contract` has it renamed. The statements that created the tables with `CREATE … IF NOT EXISTS` are gone on PostgreSQL. The tables keep the names `marker`, `ledger` and `contract` in this slice.

**Files.** [slices/1-postgres-own-space/spec.md](slices/1-postgres-own-space/spec.md).

**Writes** the decision record "each target has a contract space for Prisma's own tables" and the one on the `_prisma` prefix, and updates the decision records on contract spaces and marker storage in place.

## Slice 2. PostgreSQL: split the marker into signatures and configuration

**Outcome.** `_prisma.signatures` has one row per contract space: the hashes, when it was signed, the invariants. `_prisma.config` has one row per database: the change policy and the data protection policy. The columns nothing writes are gone. The decision record that says the marker may hold the contract's JSON is corrected in place. Policies are read from and written to `config` by every command that reads or writes them today: the PostgreSQL adapter reads `config` and hands the policies to the framework on the application space's record, as `meta.policies`, so the framework does not change in this slice.

**Files.** [slices/2-postgres-signatures-config/spec.md](slices/2-postgres-signatures-config/spec.md).

**Builds on** slice 1's phase, which is what makes moving the policies safe: the tables are in their new form before any command reads a policy.

**For whoever prepares the release that contains slice 1:** its release notes must name the API breaks recorded in the `api-breaks.json` files of prisma/orm#31234 (the two removed PostgreSQL bootstrap builders, `markerLocation`'s type, `MarkerReadResult`'s new kind, the runner's new error code and `ControlClient`'s new method); the extension upgrade instructions under `upgrade-instructions/pending/prisma-tables-in-prisma-schema/` list them with what to do.

**Must ship in the same release as slice 1, and before `8.0.0`.** Every release finds the Prisma space's own row in the marker table before it knows which form the tables are in, so the table that holds that row, and its columns, cannot change after a release has written the row. If slice 1 ships first in a release candidate, slice 2's reader must also find the row where slice 1 left it.

## Slice 3. Commands read the policies from the database's configuration

**Outcome.** The framework gets a database's policies through a channel of their own, not from a field on the application space's marker record. Each target says where it stores them: PostgreSQL in `_prisma.config`, the other targets in their marker's `meta.policies` until slice 5 moves them. A role that cannot see `_prisma.signatures` gets an error from a policy read instead of the defaults, and a refused read of `config` says it is the policies that could not be read, not "the contract marker". Commands that do not use the policies, such as `db verify`, stop reading them, so they no longer need SELECT on `_prisma.config`. Messages about the policies name where they are recorded: the corrupt-policies message, and the refusals (`MIGRATION.CHANGE_POLICY_FORBIDS` says "The marker records change: migrate" today).

**Why.** Slice 2 keeps the framework unchanged by having the PostgreSQL adapter present the `config` row as `meta.policies` on the application record. That field no longer exists in the database, the framework's messages name it, and slice 5 would have every target present the same made-up field.

**Starts with design, with the operator.** It changes framework interfaces: how commands, the runner's check under its lock and the sign path read the policies, and how the corrupt-policies error names its table. One option was sketched in slice 2's discussion: a family method that returns the recorded policies, which `databasePoliciesOf` and its callers read instead of the marker. Read ADR 320 and ADR 021 before proposing anything.

**Also in this slice.**
- A database with no application row reads as having the default policies on PostgreSQL, even when `_prisma.config` records others, because the policies reach the framework on that row. With their own channel, the `config` row is read whatever the signatures hold.
- The `config` row gets one writer. Today the adapter and the runner each write it, the runner by raw SQL, and two names that serve only that (`RECORD_DATABASE_POLICIES_SQL`, `RELEASE_CANDIDATE_MARKER_TABLE`) are exports of the published `@prisma/orm-target-postgres`. Remove them, recorded as an API break.

**Order.** After slice 2, and before `8.0.0`: it changes interfaces a target author implements, and the corrupt-policies message would otherwise ship naming a field PostgreSQL does not have. Before slice 4 if their files overlap.

## Slice 4. Rename the concept from "marker" to "signature"

**Outcome.** `verifySignature`, `db verify --signature-only`, `CONTRACT.SIGNATURE_MISSING` and the other nine codes, the error fields, the `signature` object in `--json` output, every message, the glossary, the reference docs, the upgrade instructions with a step that rewrites user code, and the shipped skill. The types extension authors import are renamed with them. In prose the term is "contract signature".

**Order.** After slices 1 to 3, and after the two pull requests that touch signing ([prisma/orm#31203](https://github.com/prisma/orm/pull/31203), the one-time hash change, and [prisma/orm#31218](https://github.com/prisma/orm/pull/31218), capabilities by database version) have merged or their sessions have agreed an order, because this slice touches about 200 source files and 500 test files.

**Records for renamed codes.** A CI check (GA compatibility project 5) fails when an error code the last release could raise is gone, unless a record names it, its reason and its replacement. Each renamed `CONTRACT.MARKER_*` code gets such a record.

**Rides along.** The temporary names `prisma_swap…` become `_prisma_swap…`, and the query aliases `__prisma_…` move to one underscore. Nothing stored changes.

## Slice 5. SQLite, MySQL, MariaDB and MongoDB

**Outcome.** Each target carries its own `_prisma` space and uses `_prisma_signatures`, `_prisma_config` and `_prisma_ledger`. MongoDB's `_prisma_migrations` collection is no longer used; its documents are moved. The decision record on MongoDB's migration state is updated in place.

**Known before starting.** MySQL's and MongoDB's runners check every space's schema, and their introspection hides Prisma's own tables by name, so the `_prisma` contract would fail its own check until that filter changes. SQLite changed a column default at `rc.15`, so its first migration accepts both. These targets are at Early Access; one that cannot be finished before `8.0.0` gets a ticket that stands alone.

## Slice 6. Prisma Studio reads the new names

**Outcome.** Studio's Migrations view reads `_prisma.ledger` and `_prisma.contract`, and falls back to `prisma_contract` for a database not yet brought up to date. Its queries are in `data/migrations.ts` in prisma/studio. A pull request there. It is safe to release at any time, and must be released before the ORM release that renames the schema.

**Also.** Console (`prisma/pdp-control-plane`) reads the same tables through Studio's `readRecordedSchema` (`packages/interactors/src/database/getRecordedDatabaseSchema.ts`), so it needs the Studio release that contains this change before that ORM release ships. The upgrade instructions' line about updating Studio names the Studio version once it is published.

## Slice 7. Decide whether PostgreSQL's contract table becomes a documented feature

**Outcome.** A recommendation to the operator, with evidence: who reads the table (Studio does; nothing in this repository), what it costs in a database with many migrations, and what a framework interface and a setting that controls storage would look like. Until then the table stays an undocumented PostgreSQL feature inside the `_prisma` schema.

## A step for the 8.0 rollout: squash the Prisma space's migrations

When Prisma 8 goes from release candidates to 8.0, the migrations of Prisma's own tables that the release candidates shipped are squashed into the fewest migrations possible, so 8.0 users are not given obsolete steps. The stream lead holds the rollout checklist this step belongs to.

The constraint: a release candidate's database records the hash of the last of these migrations it ran. After the squash, 8.0 must still recognise each such hash, and treat it as "run the first migration again", which works because every step of it skips what already holds. Otherwise 8.0 refuses that database. Design this when the step is due.
