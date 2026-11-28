# Research: names of Prisma's own tables (marker, ledger, PostgreSQL schema, MongoDB collection)

Date: 2026-11-25. Branch `ga-compatibility`. Read first: `projects/ga-compatibility/designs/7-prismas-own-tables.md`, ADR 190, ADR 021, `docs/glossary.md`, `docs/design/04-inspirations/migrations/established-conventions.md`.

## Summary

The word "marker" reaches far into what users see: one CLI flag (`db verify --marker-only`), one public client option (`verifyMarker`), ten error codes, a `marker` object in `--json` output, three documented error meta fields, about 90 output strings in the CLI, a glossary entry, and 230 lines of the shipped skill. Renaming the concept would change all of those. Renaming only the table would change none of them, but the table name would then disagree with the word every message uses. "Ledger" reaches much less: no flag, no error code and no JSON field; it appears in the glossary, in `migration log` help text and in 21 skill lines. The table and schema names themselves reach few user-facing places: the skill's two reference pages, four examples, error messages that print the table's location, and historical release notes. An earlier design note in this repository already chose "marker" and "ledger" as user-facing terms, after comparing them with Sqitch and Liquibase. No surveyed tool uses "marker" or "signature". The common words are "version", "revision", "schema history", "changelog" and "registry". "Signature" already means a cryptographic signature in Prisma's own extensions glossary and in PostgreSQL's "function signature", while `db sign` already uses it for the marker. Most tools keep one table that serves as both the current-state record and the history; Sqitch and Liquibase Secure split them, as Prisma 8 does. Both MongoDB tools surveyed use a separate collection for each purpose. ADR 190's reasoning for one MongoDB collection rests on three premises that are no longer true: the marker is no longer one document, PostgreSQL no longer uses one table, and MongoDB today does no setup at all for the collection.

## 1. How far each name reaches in this repository

Counts are from `git grep` on 2026-11-25. "Lines" counts matching lines. The word "marker" also has a few unrelated uses (the `$prismaConfig` config marker, `CONFIG.VERSION_MARKER_MISSING`, RLS "enablement markers"), so word counts are slightly high.

### 1.1 The word "marker"

User-facing places that would have to change if the concept were renamed:

- CLI flag: `prisma db verify --marker-only` (`packages/1-framework/3-tooling/cli/src/orm/db/verify.ts`, CLI README). Its conflict error `PN-CLI-4012` names it.
- Public client option: `verifyMarker?: 'onFirstUse' | false` on `postgres({...})` and the other SQL facades (`packages/2-sql-family/5-runtime/src/runtime-spi.ts`, used in `packages/3-targets/postgres/9-facade`, the Supabase extension, ADR 263, release notes v0.12.0).
- Error codes (all in `docs/reference/error-reference.md`): `CONTRACT.MARKER_MISSING`, `CONTRACT.MARKER_MISMATCH`, `CONTRACT.MARKER_READ_FAILED`, `CONTRACT.MARKER_REQUIRED`, `CONTRACT.MARKER_ROW_CORRUPT`, `MIGRATION.MARKER_ORIGIN_MISMATCH`, `MIGRATION.MARKER_CAS_FAILURE`, `MIGRATION.MARKER_LOCK_TIMEOUT`, `MIGRATION.MARKER_MISMATCH`, `MIGRATION.MARKER_NOT_IN_HISTORY`. That is ten codes. The runtime logs two of them as warnings, so users may filter logs on them.
- Error meta fields documented to users: `markerHash`, `markerStorageHash`, `markerProfileHash`.
- JSON output: a top-level `marker` object in `db verify --json` and `db init --json` (CLI README lines 390 and 993; recording `recordings/ascii/greenfield-setup/09-db-verify-json.ascii`).
- Human output: about 88 strings in `packages/1-framework/3-tooling/cli/src` name the marker, such as "Check whether the database marker and live schema match your contract" (`db verify` help), "marker when verified", "Orphan contract-space marker detected", and the `@db` ref described as "the live database marker" (`ref-resolution.ts`).
- Docs where the concept is taught: the glossary entry "Marker" (8 lines mention it; it is also used to define "change policy" and "data protection policy"); `docs/reference` 46 lines in 7 files; CLI README 68 lines; the shipped skill `skills/prisma-8` 230 lines in 37 files, including `references/quickstart.md` and `references/migrations.md`, which define it; upgrade instructions 78 lines in 35 files; examples 39 lines in 13 files; `init` output and the generated `init-readme.md` ("signs the marker").
- Design docs: ADRs 463 lines in 78 files; subsystem docs 117 lines in 8 files. These are internal to the team but are what agents read.

Command names are not affected: `db sign`, `db verify`, `db migrate` and `migration log` do not contain the word.

Internal places: 209 distinct identifiers in `packages/**/src` contain "marker", such as `ContractMarkerRecord` (89 uses), `markerLocation` (74), `readMarker` (66), `MarkerDestination`, `readAllMarkers`. 197 source files and 502 test files mention it. Two of these types reach extension authors: `ContractMarkerRecord` and `LedgerEntryRecord` are exported from the framework's contract types, and two extension upgrade guides name them.

### 1.2 The word "ledger"

User-facing: the glossary entry "Ledger"; `migration log` help and errors ("Reads the database ledger and displays every applied migration edge", "migration log needs a database connection ... to read the ledger"); the CLI README (3 lines); `skills/prisma-8` (21 lines in 9 files, for example `references/migration-review.md` "the database's ledger records the migration as applied"); upgrade instructions (5 lines). No flag, error code, JSON field or option contains "ledger".

Internal: 46 distinct identifiers in source (`LedgerEntryRecord`, `readLedger`, `writeLedgerEntry`, `LEDGER_TABLE_NAME`); 54 source files, 105 package files in total, 34 files under `test/`.

### 1.3 The stored names

| Name | Files (lines) | User-facing places |
| --- | --- | --- |
| `prisma_contract` (PostgreSQL schema) | 122 (294) | `skills/prisma-8/references/migrations.md` and `quickstart.md`; `examples/react-router-demo/README.md` ("creates the prisma_contract.marker table"); `drop-db.ts` scripts in `prisma-8-demo`, `prisma-8-postgis-demo`, `paradedb-demo`; error messages, which print `markerLocation` (for example the `CONTRACT.MARKER_ROW_CORRUPT` fix text "The prisma_contract.marker row for space ... Delete the row"); release notes rc.21 and rc.25 and the rc.20-to-rc.21 upgrade instructions (historical). ADR 021 tells users to grant application roles `SELECT on prisma_contract.marker`. |
| PostgreSQL `contract` table | `prisma_contract.contract`; content-addressed contract snapshots keyed by `core_hash`, joined from the ledger (`control-adapter.ts` line 596; ADR 240) | None found beyond ADR 240 and tests. |
| `_prisma_marker` (SQLite, MySQL) | 56 (109) | Release notes rc.21 and the rc.20-to-rc.21 upgrade instructions only. 36 of the files are in `packages/3-targets`. |
| `_prisma_ledger` (SQLite, MySQL) | 24 (39) | None. Only ADR 190 among docs. |
| `_prisma_migrations` | 53 (138) | Two meanings. MongoDB's collection: `skills/prisma-8/references/migrations.md` and `quickstart.md`, `examples/mongo-demo/README.md`, subsystem doc 10, ADRs 021 and 190. Prisma 7's table: `examples/prisma7-adoption/README.md`, ADRs 252 and 267, release notes rc.18. The PostgreSQL adapter skips it as another tool's table (`OTHER_TOOL_MIGRATION_TABLES`); the MongoDB adapter skips it from introspection as its own (`introspect-schema.ts`). |

ADR 021 is out of date on names: it gives SQLite's table as `prisma_contract_marker`; the code uses `_prisma_marker`.

### 1.4 Existing uses of "sign" and "signature" for the marker

The repository already pairs the marker with signing. `db sign` writes markers. `error-reference.md` calls the marker "the marker (signature) stored in the database" and "contract marker (database signature)". The CLI's `db sign` output says "its signature was not written", and the type `SpaceSignature` describes what signing did to a marker. The glossary says "the database is signed with the contract's hash".

## 2. Prior art

"Separate" means separate stores for "which state the database is in now" and "history of what was applied".

| Tool | Current-state record | History record | Separate? | Own schema on PostgreSQL | Source |
| --- | --- | --- | --- | --- | --- |
| Flyway | none; derived from history | `flyway_schema_history` | No | No; the default schema, configurable | [table setting](https://documentation.red-gate.com/fd/flyway-table-setting-277579042.html): default "flyway_schema_history"; [history table page](https://documentation.red-gate.com/fd/flyway-schema-history-table-273973417.html) |
| Liquibase | `DATABASECHANGELOG` (one row per changeset run; a rollback removes the row) | `DATABASECHANGELOGHISTORY` (Liquibase Secure 4.27+, "track all changes"); lock in `DATABASECHANGELOGLOCK` | Yes, in the paid edition | Optional: `liquibaseSchemaName` "specifies the schema to use for the creation of Liquibase objects" | [DATABASECHANGELOG](https://docs.liquibase.com/concepts/tracking-tables/databasechangelog-table.html), [liquibase-schema-name](https://docs.liquibase.com/parameters/liquibase-schema-name.html) |
| Alembic | `alembic_version`, column `version_num`, one row per head, updated in place | none | Not applicable; no history kept | Optional `version_table_schema` | [runtime API](https://alembic.sqlalchemy.org/en/latest/api/runtime.html), [migration.py](https://github.com/sqlalchemy/alembic/blob/main/alembic/runtime/migration.py) |
| Rails | `schema_migrations` (one row per applied version) | same table | No | No | [model_schema.rb](https://github.com/rails/rails/blob/main/activerecord/lib/active_record/model_schema.rb): defaults `"schema_migrations"` and `"ar_internal_metadata"`; [guide](https://guides.rubyonrails.org/active_record_migrations.html) |
| Rails `ar_internal_metadata` | key/value table with `environment` and, optionally, `schema_sha1` | not history | Not applicable | No | [internal_metadata.rb](https://github.com/rails/rails/blob/main/activerecord/lib/active_record/internal_metadata.rb). What `schema_sha1` is used for was not confirmed from a primary source. |
| Django | `django_migrations` (`app`, `name`, `applied`) | same; "If a migration is unapplied its row is removed" | No | No | [recorder.py](https://github.com/django/django/blob/main/django/db/migrations/recorder.py) |
| Drizzle | none | `__drizzle_migrations` (`id`, `hash`, `created_at`) | No | Yes, schema `drizzle` by default | [config docs](https://orm.drizzle.team/docs/drizzle-config-file), [pg dialect.ts](https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/pg-core/dialect.ts) |
| Kysely | none | `kysely_migration` (`name`, `timestamp`); lock `kysely_migration_lock` | No | Optional `migrationTableSchema` (PostgreSQL, MSSQL) | [migrator.ts](https://github.com/kysely-org/kysely/blob/master/src/migration/migrator.ts) |
| Knex | none | `knex_migrations`; lock `knex_migrations_lock` | No | Optional `schemaName` | [migrations guide](https://knexjs.org/guide/migrations.html) |
| Atlas | none | `atlas_schema_revisions` | No | When the URL binds no schema, "the table is stored in its own schema called `atlas_schema_revisions`"; `--revisions-schema` overrides | [versioned apply](https://atlasgo.io/versioned/apply) |
| Sqitch | `changes` ("Tracks the changes currently deployed") | `events` ("Contains full history of all deployment events"); also `projects`, `tags`, `dependencies`, `releases` | Yes | Yes: the "registry", default `sqitch` | [configuration](https://sqitch.org/docs/manual/sqitch-configuration/), [pg.sql](https://github.com/sqitchers/sqitch/blob/develop/lib/App/Sqitch/Engine/pg.sql) |
| golang-migrate | `schema_migrations` (`version`, `dirty`), one row, truncated on every write | none | Not applicable | Only through a quoted table name such as `"migrate"."schema_migrations"` | [postgres.go](https://github.com/golang-migrate/migrate/blob/master/database/postgres/postgres.go) |
| EF Core | none | `__EFMigrationsHistory` | No | Optional, via `MigrationsHistoryTable(name, schema)` | [history table](https://learn.microsoft.com/en-us/ef/core/managing-schemas/migrations/history-table) |
| Prisma 7 | none | `_prisma_migrations` | No | No | [migration histories](https://www.prisma.io/docs/orm/prisma-migrate/understanding-prisma-migrate/migration-histories). Columns are given in this repo's `established-conventions.md`; not re-checked against the engines source. |
| migrate-mongo | none | collection `changelog`; lock `changelog_lock` | No (separate lock) | Not applicable | [sample config](https://github.com/seppevs/migrate-mongo/blob/master/samples/commonjs/migrate-mongo-config.js) |
| Mongock 5 | none | collection `mongockChangeLog`; lock `mongockLock` | No (separate lock) | Not applicable | [driver docs](https://docs.mongock.io/v5/driver/) |

Observations from the table:

- Most tools keep one table that is both history and current state; the current state is derived from it. Alembic and golang-migrate keep only current state. Only Sqitch and Liquibase Secure keep both, separately.
- Names with the tool's name and no leading underscore are the majority: `flyway_`, `alembic_`, `django_`, `kysely_`, `knex_`, `atlas_`, `mongock`. Leading underscores: Drizzle (two), EF Core (two), Prisma 7 (one). Rails, golang-migrate and migrate-mongo use generic names.
- Tools with their own PostgreSQL schema by default: Drizzle (`drizzle`), Sqitch (`sqitch`), and Atlas when the URL names no schema (`atlas_schema_revisions`). Liquibase, Alembic, Kysely, Knex and EF Core offer it as an option.
- Both MongoDB tools put different kinds of record (history, lock) in different collections. Neither keeps a current-state document.
- Prisma 7 never created `_prisma_migrations` on MongoDB: its docs say "there are no plans to add support for Prisma Migrate" for MongoDB ([MongoDB page](https://www.prisma.io/docs/orm/overview/databases/mongodb)). So on MongoDB the clash with Prisma 7 is in the name and the docs, not in any real database.

## 3. Words for "the record of which state the database is in"

Words used by the tools above, from their docs or source:

- "version": Flyway ("current version", derived), golang-migrate (`version`), Alembic (`alembic_version`, `version_num`).
- "revision" and "head": Alembic, Atlas (`atlas_schema_revisions`).
- "schema history": Flyway; "migrations history": EF Core.
- "changelog": Liquibase, migrate-mongo, Mongock.
- "registry": Sqitch, for its whole store; "changes currently deployed" for the current-state table.
- "internal metadata": Rails.

The act of recording a state without running migrations, which is what `db sign` does, is called "stamp" in Alembic (`stamp()` "updates the version table") and "baseline" in Flyway. The Flyway name was not checked against its docs in this research.

No surveyed tool uses "marker" or "signature" for this record. This repository's `established-conventions.md` (section 3, "Verdict") already recorded: "Adopt 'marker' and 'ledger' as user-facing terms", mapping them to Sqitch's `changes` and `events`. Renaming either term would reverse that verdict, and the glossary entries that teach them.

"Signature" has established meanings nearby that could mislead:

- A cryptographic signature, made with a private key to prove who produced something. Prisma's own `docs/reference/extensions-glossary.md` uses it this way ("Bundle Signing: cryptographic signatures for preflight bundles"), as does the Supabase JWT error. None of the migration tools surveyed sign anything; they store checksums or hashes (Flyway, Liquibase, Atlas's `atlas.sum`), so a reader may expect a signature to be verifiable against a key, which the marker is not.
- In PostgreSQL, a "function signature" is a function's name and argument types. A table of "contract signatures" in a PostgreSQL schema could be read that way by a database administrator. This is an inference, not a documented confusion.
- On the other side, the repository already uses "sign" for writing the marker (`db sign`) and calls the marker a "signature" in the error reference and in `db sign` output. So "signature" would match the command's verb.

## 4. Does ADR 190's reasoning for one MongoDB collection still hold?

ADR 190 rejected separate `_prisma_marker` and `_prisma_ledger` collections because it "doubles the setup (two collections to create, two to query, two to reason about) with no meaningful benefit". It also said one collection "mirrors the single-table pattern Postgres uses". The code today:

- The marker is not one document. ADR 190 shows a singleton `{ _id: "marker" }`. Today there is one marker document per contract space, keyed `_id: <space>`, `space: <space>` (`packages/3-targets/mongo/2-adapter/src/core/migrations/mongo-control-adapter.ts`; ADR 021 line 60). ADR 190's own example is out of date.
- PostgreSQL does not use one table. It has separate `marker`, `ledger` and `contract` tables; SQLite and MySQL have separate `_prisma_marker` and `_prisma_ledger`. MongoDB is the only target that shares.
- There is no setup to double today. Nothing creates the collection, an index or a validator; MongoDB creates it on first write. Under the project 7 design, the `_prisma` space's first migration would create it, so two collections would mean two `createCollection` operations in that one migration.
- Querying is already separate. Every marker read filters on `_id` being a string equal to `space`, and every ledger read filters on `type: 'ledger'`. Two collections would not add queries.
- Sharing has costs visible in the code: a hand-written union document shape (`MarkerLedgerDocShape`, in `marker-ledger-collection.ts`) holding both sets of fields; marker documents have no `type` field, so they are told apart from ledger documents by the type of `_id`; the "ledger location" shown in error messages is a sentence, not a name (`MONGO_LEDGER_COLLECTION = "_prisma_migrations ledger documents in _prisma_migrations"`, `marker-ledger.ts`).
- Under project 7, the space's contract would have to describe the shared collection. MongoDB contracts support a discriminator and variants (subsystem doc 10), so one collection with two document kinds can be described, but only after marker documents gain a discriminator field. This is an inference from the docs; it was not tried.
- ADR 190's point that the two kinds "coexist without interference" still holds.

So the premises about the marker's shape, PostgreSQL's layout and setup cost no longer hold. The point that sharing does no harm still holds. Both MongoDB tools surveyed use one collection per kind of record.
