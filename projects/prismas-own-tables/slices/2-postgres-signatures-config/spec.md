# Slice 2: PostgreSQL splits the marker into signatures and configuration

Part of [the plan](../../plan.md). Read [design.md](../../design.md) section 8, [amendments.md](../../amendments.md) (sections 1, 2, 3, 5, 7 and 11 above all), and slice 1's [spec](../1-postgres-own-space/spec.md) first. The design is strong guidance and our best effort, not a fixed specification. Its purpose is fixed: every name and every column Prisma keeps in a PostgreSQL database at `8.0.0` is one we can keep for all of Prisma 8. Where the code shows the mechanism wrong, say so with evidence.

This slice is a pull request stacked on slice 1's branch (`own-tables-contract-space`, prisma/orm#31234). The two reach `main` together, so no release contains slice 1 without this slice. That is why this slice rewrites slice 1's first migration instead of adding a second one (amendments section 2).

## What is true when this slice is done

1. **A fresh database gets `_prisma.signatures`, `_prisma.config`, `_prisma.ledger` and `_prisma.contract`,** and no `_prisma.marker`.
   - `signatures`: one row per contract space. Columns `space text` (primary key), `core_hash text not null`, `profile_hash text not null`, `invariants text[] not null default '{}'`, `signed_at timestamptz not null default now()`. The columns `contract_json`, `canonical_version`, `app_tag` and `meta` are gone: nothing reads them, and every writer writes `NULL` or `{}` (amendments section 3).
   - `config`: at most one row, for the whole database. It holds the change policy and the data protection policy as `policies jsonb not null default '{}'`, in exactly the stored form the framework parses today from `meta.policies` (ADR 320: the framework owns that form and its parser). A key that admits only one row, chosen the idiomatic PostgreSQL way and stated in the pull request. No row means the defaults, as an empty `meta` does today.
   - `ledger` and `contract` are unchanged.
2. **A database created by a release candidate is brought up to date with no manual step.** The first migration renames `prisma_contract` to `_prisma` as slice 1 does, then moves each `marker` row into `signatures` (hashes, invariants, `updated_at` as `signed_at`), moves the application row's `meta.policies`, when present, into `config`, and drops `marker`. Every earlier row is kept. Each step is skipped when its result already holds, so a second command racing the first does no harm.
3. **The Prisma space's own row is read from `_prisma.signatures`** by the phase, by `db verify`, and by every reader. This is the place every later release of Prisma 8 and later majors look for it (ADR 339, "One thing must stay fixed"), so it must be right now.
4. **The policies are read from and written to `_prisma.config` on PostgreSQL** by every command that reads or writes them today: `db migrate`, `db update`, `db init`, `db sign`, `db migrate --show`, `migration status`. The runner's check that the policies did not change under it, while it holds its lock, reads `config`. A run that changes only the policies writes `config` and no signature. SQLite, MySQL, MariaDB and MongoDB keep `meta.policies` in their marker until slice 4.
5. **Messages name the right table.** A corrupt signature row names `_prisma.signatures`. Corrupt policies are still reported through the framework's marker message until the next slice. A database whose tables are missing is told about the tables that are missing. Nothing on PostgreSQL tells a user to correct `meta.policies` in a marker.
6. **Commands that only read** still report `CONTRACT.PRISMA_SPACE_BEHIND` for a release candidate's database; the probe of `prisma_contract.marker` stays, since that is the release candidate's form.
7. **The SQL client's check on first use** reads `_prisma.signatures`.

## How the policies reach the commands

Today the framework reads the policies from the application space's marker record (`databasePoliciesOf(marker)` reads `marker.meta.policies`; `databasePoliciesInForce` and six callers in the command line; `checkDatabasePoliciesHeld` and the sign path's conflict check in the SQL family).

**Decided on 2026-11-28: in this slice, the PostgreSQL control adapter reads `_prisma.config` beside `_prisma.signatures` and returns the application space's record with `meta: { policies }` taken from the `config` row.** No framework change. Every reader of the policies (the commands, the runner's check under its lock, the sign path's check) then reads `config` on PostgreSQL. Known and accepted until the next slice: the framework's messages about corrupt policies still say "meta.policies in the marker" and name `_prisma.signatures`.

The next slice makes the commands read the policies through a channel of their own, with its design worked out with the operator first. Recorded in [the plan](../../plan.md).

## The first migration

Rewritten in place: `packages/3-targets/postgres/1-target/migrations/20261126T1200_create_prisma_tables/`, re-emitted from an updated `src/contract.prisma`. Its hash changes; no database has recorded it, since slice 1 has never been released. Keep slice 1's prechecks (release-candidate columns, ownership, `CREATE` on the database, both schemas present, empty `_prisma`), and add the steps in point 2. The release candidate's `marker` columns are checked before anything moves, as today. Labels follow the planner's style ("Create table …", "Move … into …"), because they are recorded in the ledger for good.

## Proof

- **The upgrade test** from slice 1 (`prisma-tables-space.integration.test.ts` and the command-line journey), extended: the release candidate's database has an application row with `meta.policies` and an extension row; after `db migrate`, `signatures` holds every row with its hashes and invariants, `config` holds the policies, `marker` is gone, and the command obeys the moved policies (a `migrate`-only database refuses `db update`). A second run changes nothing.
- A fresh-database test; a policies round trip through `config` with `--permit-policy-change`; the runner's policies-moved check against `config`; the descriptor consistency test from slice 1.
- Each new test is seen to fail when the behaviour it covers is broken.

## Boundaries

- Only PostgreSQL's tables change. Other targets behave exactly as before.
- No user-visible "marker" word is renamed outside the PostgreSQL packages' table names and the messages in point 5; the concept's rename is slice 3. Lock names stay.
- No framework changes.
- prisma/orm#31203 and #31200 will change the space's files once more; whichever merges last re-emits them (slice 1's spec says how).

## Docs this slice writes

Written by the orchestrator: ADR 021 and ADR 042 corrected in place (the marker's table, its dropped columns), ADR 320's "Where the policies live", ADR 339, the glossary entries for the marker, the change policy and the data protection policy, the Migration System subsystem doc, and slice 1's upgrade instructions fragment and skill text where they name `_prisma.marker`.
