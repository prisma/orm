# GA readiness: analysis

This file holds verified facts about the code and records today, and working material that is not decided. Nothing here is a decision. What we agreed is in [spec.md](spec.md).

## Current state

Verified against the code and the decision records.

**Published surface**

- 21 packages, all `@prisma/orm-*`, at one shared version, depending on each other by exact version. About 1,050 entrypoints in total; `@prisma/orm-postgres` has 164.
- No entrypoint is marked GA or internal. `@prisma/orm-postgres/internal/*` is published for the Supabase extension.
- A team at Microsoft is building a SQL Server target outside this repository.

**Stored data**

- `contract.json` has a format version, `schemaVersion`, always `'1'`. It is an input to the storage, profile and execution hashes. No reader checks it.
- Contract readers reject an unknown top-level key with a validation error. `migration.json` rejects an unknown field, and the migration then fails to load. A release that adds a field therefore breaks every earlier release.
- Migration files, ref files and the ledger have no format version. The marker has a `canonical_version` column that is always null and unused.
- The SQL runtime reads the marker before the first query. A missing marker or a hash mismatch logs a warning. A read or decode failure fails the query, and every later query until a read succeeds. The MongoDB runtime does not check the marker.
- The ledger is read by `migration status`, by `migration log`, and by `db migrate` to explain a marker mismatch. It does not decide what is applied.

**Checks**

- No check compares the public API of a release with an earlier one. The upgrade-instruction tests run the current code on a project as an earlier release left it, one test per breaking change. No suite does that for every release.
- CI runs one TypeScript version, 5.9.3. Packages declare `typescript >=5.9`.
- Nothing detects a removed or renamed error code.

**Releases and upgrades**

- Every release publishes from `main` to the `latest` tag. The version script cannot produce `8.0.0`, and a patch to an earlier minor cannot be published.
- Upgrade guides are written for an agent to apply. Of 1,033 upgrade guide entries, 46 have a script. No command applies an upgrade.

**Below GA**

- MySQL and MariaDB state "support is early" in their READMEs. SQLite, MongoDB and the ParadeDB extension carry no indication in the package.
- Prisma 8 has no experimental or preview setting.

**Other Prisma products**

- Composer and the `prisma` CLI pin the ORM to an exact version. Composer publishes a package that contains a contract and migrations.
- pdp-control-plane parses `prisma migration status --json` in its deploy pipeline.

## Consequences for `8.0.0` (the author's reading, not decided)

These cannot be added to `8.0.0` after it ships. The upgrade instructions from the last release candidate to `8.0.0` cover them. Item 1 changes every storage hash, so each existing database must be moved to its new hash. Whether that is done by `db sign` or by a migration with no operations is not decided.

1. The contract's format version is renamed and removed from the storage hash inputs. Existing migrations, snapshots and ref files are rewritten by the upgrade tool.
2. Migration files and ref files carry a format version. Readers of all stored files check it.
3. A command that meets an unknown format version reports that, not a validation failure, a migration that failed to load, or a corrupt marker.
4. The SQL runtime's marker check does not fail a query.
5. A decision on how the marker and ledger are versioned (section 6.4).

Items 1 and 2 change the framework domain and the contract readers in the family packages.

## Existing records the decided policy contradicts

- The no-backward-compatibility rules in `CONTRIBUTING.md`, the architecture overview and the repository rules.
- The decision records that handle a format, canonicalization or codec id change by telling users to emit and sign again.
- The record that lists the format version as a storage hash input.
- The marker record's statement that the runtime refuses to execute on a mismatch.
- The ledger and marker records' statements on upgrade paths.
- `docs/oss/versioning.md` and `SECURITY.md`.
- The per-release upgrade guide lifecycle.
- The rule that a renamed PSL name is removed after "one release line".

## Proposed, not yet discussed

### Verification

*(proposed)* The goal in section 1 is a claim about older code and older data working on a newer release. Today this is tested only for individual breaking changes: some upgrade-instruction tests and CLI tests (under `test/integration/test/`) run the current code on a project as an earlier release left it.

The checks must not grow with the number of releases. Three kinds of check achieve that.

**A comparison with the previous release.** The list of exported names and their types is recorded at each release. A pull request that removes or incompatibly changes an entry in the previous release's list fails. One comparison is enough: if each release keeps every export the previous release had, it keeps every export every earlier release had.

**Tests that are only added to.** Tests are written against the published packages, using only public APIs, as an application would. They include type tests, because a query's result type is computed from the user's input and can change without any exported signature changing. Tests are added, and existing tests are not edited. A pull request that edits an existing test must say which class of change in section 5.2 it is, and that statement becomes the release note.

**Saved samples.** A file written by `8.0.0` stays in a user's repository unchanged, so a later release must read it directly, whatever happened in between. These checks therefore keep every sample:

- **Stored data.** One sample of each file format version is saved when that version is introduced. The current code must read each of them. The number of samples grows with the number of format versions, not with the number of releases.
- **Hashes.** A fixed set of stored contracts is saved with their hashes. The current code must compute the same hashes.

The per-surface design documents specify these checks and the ones this section leaves out: generated types from an earlier emit, an extension's shipped contract, an earlier application instance reading a marker a later release wrote, the TypeScript version range, and CLI output and the config file.

### Other statements removed from the spec because they are not decided

- *(proposed)* Using anything below GA requires a step that is visible in the user's project: a package installed or a name imported.
- Today the migration hash also breaks ties between otherwise equal migration paths (`packages/1-framework/3-tooling/migration/src/migration-graph.ts`); whether it keeps that role is for the migrations design document.
- *(proposed)* The installed release recomputes the hash of each stored contract snapshot and each extension's contract and compares it with the recorded hash. If a release changed the rules it hashes by, existing snapshots would be reported as tampered with (`packages/1-framework/3-tooling/migration/src/contract-snapshot-store.ts:54-57`). So within a major, either those rules do not change, or stored content is hashed by the rules of the format version it was written in.
- An upgrade writes nothing to the database. Deploying a new release therefore does not change what running instances of the old release read.
- No release requires such a command to be run in order to keep working.
- *(proposed)* A deprecation ships with a tool that moves code to the replacement. A change that cannot be translated mechanically counts against making the change.

## PSL name resolution today

Verified in `packages/1-framework/2-authoring/psl-parser/src/scope.ts`. A name is looked up in nested scopes: the enclosing namespace's own declarations first, then the document's declarations (models, composite types, named types, namespaces), and last the types contributed by the target and by extensions. So a user's declaration already takes precedence over a built-in type of the same name. Contributed types can also sit under a namespace and be written with a qualified name.

## What extensions read today

Verified by searching the first-party extensions' source. None of pgvector, postgis, paradedb, citext, arktype-json or middleware-cache reads the content of the user's contract. The Supabase extension reads one value from its own contract, the storage hash. Code that branches on the kind of a query-tree node is in the ORM client and the Supabase extension.

## A real database whose ledger table is older than the current one

Reported by another session on 2026-11-23, from the telemetry backend (`apps/telemetry-backend`), whose deploy has failed on every run since about June 2026. The cause was checked in the code; the production state and the rehearsal were not checked by this session.

- The ledger table's columns changed in early June 2026. Production's ledger has no `space`, `migration_name` or `migration_hash` column.
- `packages/3-targets/postgres/1-target/src/contract-free/control-bootstrap.ts` creates the control schema and the marker, ledger and contract tables with `ifNotExists: true` (lines 46, 53, 60, 64). An existing ledger table is left as it was. Nothing adds the new columns.
- Rehearsed on a database of production's shape: `db sign` succeeds, because it writes only the marker. `db migrate` then fails while writing the ledger row, with `column "space" of relation "ledger" does not exist`. The transaction rolls back.
- The documented recovery (emit again, `db sign`, then migrate) therefore stops at the ledger write for any PostgreSQL database set up before early June 2026. The only ways past it today are to change or drop the control tables by hand.

This is the case that section 6.4 of the spec rules out: a change to the ledger that is neither additive for existing databases nor made by a command the user runs. It bears on the open question of managing Prisma's own tables with Prisma's own migration system.

## What the sibling products import from the ORM

Found by a search agent on 2026-11-23 in the clones under `wip/repos/`. Not rechecked by hand.

- **The `prisma` CLI** (prisma-cli) depends on `@prisma/orm-toolchain` only, and imports one entrypoint, `@prisma/orm-toolchain/cli`, in one file.
- **Composer** depends on `@prisma/orm-postgres` and `@prisma/orm-toolchain`. Beyond what an application imports from the facade, it imports the toolchain's migration tooling (`/migration-tools/spaces`, `/io`, `/refs`, `/hash`), `/config-loader` and `/cli`, and the facade's `/control` and `/family/control`.
- **pdp-control-plane** depends on `@prisma/orm-postgres`, `@prisma/orm-family-sql` and `@prisma/orm-toolchain`. It is mostly an application. It also imports from the family package directly (`/orm-client`, `/errors`, `/runtime`, `/builder/types`, `/relational-core`), which the facade re-exports, and the toolchain's `/cli/control-api` in a test.
- None of the three imports an entrypoint named `internal`.
- All three pin an exact version: Composer and the CLI at `8.0.0-rc.24`, pdp-control-plane at `8.0.0-rc.23`. Composer has a script that enforces the pin.
