# ActiveRecord (Ruby on Rails)

> One-line description: timestamp-ordered, file-backed Ruby classes that describe schema (and sometimes data) transformations, applied forward or backward against a database while a separate schema dump tracks the resulting shape.

## Mental model

The migration domain is a **single linear timeline** ordered by a numeric prefix on each file (by default a UTC `YYYYMMDDHHMMSS` “version”). The **unit of change** is one migration class (typically one file under `db/migrate/`); its body is usually **imperative Ruby** calling a database-agnostic DSL (`create_table`, `add_column`, …), optionally mixed with raw SQL (`execute`) or application code. The **unit of identity** for “has this run?” is that numeric **version** extracted from the filename, not a content hash. Rails compares the ordered set of migration files to rows in the database table `schema_migrations` to decide what is **pending** vs already applied. **Graph-based** branching of history is not a first-class concept: branches reconcile at the VCS level, and the docs describe resolving schema dump merge conflicts by re-running `db:migrate` to regenerate `db/schema.rb`. Separately, the **authoritative shape** of an empty database for bootstrapping is framed as the live database (and its dumped artifact `db/schema.rb` or `db/structure.sql`), not the replayability of the entire migration chain.

The guides contrast **schema work** (structure) with **data work** (row changes): both can live in migration classes, but long-running or hard-to-reverse data changes are called out as poor fits for the same mechanism. **Declarative** aspects show up in generators and in `schema.rb` as a summarized state; **imperative** steps remain the norm inside each migration file. Reversibility is optional but first-class: many operations inside `change` are automatically invertible; others require `reversible`, split `up`/`down`, or an explicit `ActiveRecord::IrreversibleMigration` barrier.

## Vocabulary

### Nouns

- **Migration**: A Ruby class (subclass of `ActiveRecord::Migration[API]`) describing transformations to apply to the database; stored as a file under `db/migrate/`.
- **`ActiveRecord::Migration[8.1]` (version tag)**: The bracketed suffix selects a compatibility layer for migration behavior tied to a Rails/Active Record release line (examples in current guides use `8.1`).
- **Schema migration**: Phrasing used when a generated migration only adds/removes columns (contrasts with broader “migration” that may include data work).
- **Version**: The numeric prefix of the migration filename; used as the migration’s identity in `schema_migrations` and in CLI `VERSION=` targeting.
- **Timeline / history**: Informal terms for the ordered sequence of migrations from empty schema to current.
- **Transformation**: Rdoc wording for what `up`/`down`/`change` describe—schema or supporting data steps packaged in a self-contained class.
- **DSL (migration DSL)**: The Ruby methods available inside `change`, `up`, or `down` for portable schema operations (`create_table`, `add_index`, …).
- **SchemaStatements**: API family (`ActiveRecord::ConnectionAdapters::SchemaStatements`) hosting most per-table/column/index/foreign-key helpers invoked from migrations.
- **TableDefinition / table block**: Object yielded by `create_table { |t| … }` for declaring columns inside a new table.
- **`change_table` table object**: Object yielded by `change_table` for batched alterations on an existing table.
- **Schema dump**: The generated artifact reflecting current DB structure—either `db/schema.rb` (Ruby) or `db/structure.sql` (SQL), depending on `config.active_record.schema_format` / `schema_format` in config.
- **`schema.rb`**: Ruby file resembling one large migration produced by introspecting the database; includes `ActiveRecord::Schema[…].define(version: …)`.
- **`structure.sql`**: Database-native structural dump (e.g. `pg_dump` output for PostgreSQL; `SHOW CREATE TABLE` aggregates for MySQL/MariaDB per guides) used when Ruby schema cannot represent DB-specific objects.
- **`schema_migrations` table**: Database table recording each applied migration **version** string in a `version` column.
- **Pending migration**: A migration file whose version is not present in `schema_migrations` (and therefore eligible to run on `db:migrate`).
- **`ActiveRecord::PendingMigrationError`**: Exception documented on `ActiveRecord::Migration` for cases where pending migrations exist across DB configurations and a check fails (boot-time guard pattern in API docs).
- **Engine migration**: A migration copied from a Rails Engine into the host app, annotated with a comment pointing at the engine origin and original version.
- **Generator / migration generator**: `bin/rails generate migration …` (or `g migration`), optionally inferring column statements from naming patterns.
- **Join table**: Table naming and columns created by `create_join_table` / `JoinTable` generator patterns for many-to-many style links; default name derives from lexical ordering of model name arguments.
- **Reference / `belongs_to` column type**: Shorthand for a `*_id` column (and optional index / foreign key) created via `references` or `belongs_to` in generators or `add_reference` / `add_belongs_to`.
- **Polymorphic reference**: Pair of `*_type` and `*_id` columns (plus indexes) for polymorphic associations when `polymorphic: true` is used.
- **Foreign key constraint**: Constraint added explicitly (`add_foreign_key`) or via `foreign_key: true` on references; guides note single-column FK support in Active Record helpers vs composite keys requiring SQL/`structure.sql`.
- **Index**: Structure added with `add_index` (including uniqueness, order, custom name options in API summaries).
- **`timestamps`**: Macro adding `created_at` and `updated_at` columns expected to be managed by Active Record when present.
- **Column modifier**: Options such as `null`, `default`, `limit`, `precision`, `scale`, `comment`, `collation` applied when defining or changing columns.
- **Primary key**: Default implicit `id` column; configurable (`primary_key:` rename, array for composite primary key, `id: false`).
- **UUID primary keys**: Configuration and migrations can set `id: :uuid` and matching reference column types; may rely on DB extensions (e.g. `gen_random_uuid()` on PostgreSQL).
- **Data migration**: Using a migration to change rows; guides warn on lifecycle, rollback, and performance separation from schema migrations.
- **Seeds**: `db/seeds.rb` executed via `db:seed` / `db:seed:replant`, described as the idiomatic place for repeatable baseline data instead of many data migrations.
- **Irreversible migration**: A migration whose backward path cannot be defined safely; signaled with `ActiveRecord::IrreversibleMigration`.
- **Transactional migration**: Expected DDL transaction wrapper when the adapter supports it; failures roll back successful parts within that transaction per guides.
- **`disable_ddl_transaction!`**: Class-level opt-out for migrations that must run statements invalid inside a transaction (example: certain `ALTER TYPE … ADD VALUE` flows on PostgreSQL in guides).
- **`CommandRecorder`**: Subsystem referenced by API docs listing which `change` operations are automatically reversible.
- **`migrations_paths`**: `config/database.yml` option overriding where migration files are loaded from.
- **Environment**: `RAILS_ENV` (e.g. `development`, `test`, `production`) selecting which database configuration migrations run against.
- **Primary database / `seeds: true`**: Terms appearing in `db:prepare` behavior notes—seeding predicates tied to which configured database is primary or explicitly marked for seeds.
- **File name pattern `YYYYMMDDHHMMSS_name.rb`**: UTC timestamp + underscore + snake_case descriptive name; Rails derives execution order from the numeric prefix.
- **Migration class name ↔ file suffix**: Guides require CamelCase class matching the descriptive portion after the timestamp (`CreateProducts` for `…_create_products.rb`).
- **CLI type shorthand in generators**: Column declarations like `name:string` default omitted types to `string`; `field:type:index` can emit matching `add_index`.
- **Curly-brace column options**: Generator syntax such as `'price:decimal{5,2}'` maps to `precision`/`scale` options on `add_column`.
- **`!` column suffix**: Generator shorthand (e.g. `email:string!`) maps to `null: false` on the new column.
- **`{ polymorphic }` on references**: Generator modifier producing `polymorphic: true` on `add_reference`.
- **`force: :cascade` / `force: true`**: Options appearing in dumped `schema.rb` examples controlling table recreation semantics when loading schema.
- **Merge conflict (schema file)**: Docs name VCS conflicts in `schema.rb` / `structure.sql` as routine, with regeneration via `db:migrate` as the suggested resolution path.

### Verbs

- **Migrate (`db:migrate`)**: Run `change`/`up` for all pending migrations in timestamp order; may target an explicit `VERSION=`.
- **Rollback (`db:rollback`)**: Run `down` or reverse `change` for the most recent migration(s), optionally `STEP=n`.
- **Dump schema (`db:schema:dump`)**: Refresh `db/schema.rb` or `db/structure.sql` from the database (invoked as part of `db:migrate` per guides).
- **Load schema (`db:schema:load`)**: Build an empty database from the schema file instead of replaying migrations.
- **Create / drop / rename (tables)**: `create_table`, `drop_table`, `rename_table` as migration-level schema verbs.
- **Add / remove / rename / change (columns)**: `add_column`, `remove_column` / `remove_columns`, `rename_column`, `change_column`, `change_column_null`, `change_column_default`.
- **Add / remove (indexes, FKs, timestamps)**: `add_index`, `remove_index`, `add_foreign_key`, `remove_foreign_key`, `add_timestamps`, `remove_timestamps`.
- **Add / remove reference**: `add_reference`, `remove_reference` (and `add_belongs_to` alias).
- **Create / drop join table**: `create_join_table`, `drop_join_table`.
- **Execute (`execute`)**: Run arbitrary SQL strings inside `up`/`down`/`reversible` blocks when the DSL is insufficient.
- **Revert (in-code `revert`)**: API that programmatically applies the inverse of another migration class or block inside a newer migration.
- **Reversible (`reversible` block)**: Declare distinct `up` and `down` fragments inside `change` for operations Rails cannot infer.
- **`up_only`**: API method noted on `ActiveRecord::Migration` for defining forward-only fragments in mixed-style migrations.
- **Announce / say / `say_with_time` / `suppress_messages`**: Output-control verbs for migration logging and benchmarking during runs.
- **Reset column information (`reset_column_information`)**: Model-level call documented for reloading attribute metadata after DDL when later using the same model inside a migration.
- **Squash / prune (informal in “Old Migrations”)**: Deleting obsolete migration files while treating the schema dump as the rebuild source of truth (with caveats about `schema_migrations` rows for missing files).

### Events / lifecycle states

- **Migrating / migrated**: Console phases around a migration (`== ClassName: migrating`, `migrated`) including per-step benchmarks.
- **Up / down (migration status)**: Labels in `db:migrate:status` indicating whether a version has been applied or not.
- **`********** NO FILE **********`**: Status display when `schema_migrations` contains a version whose file was deleted from `db/migrate/`.
- **Schema drift**: Described outcome if `db:migrate:reset` replays an edited/reordered/removed migration history instead of loading the current dump.
- **Migration failure (transactional)**: On adapters with DDL transactions, partial migration body rolls back; without them, successful steps may remain, requiring manual rollback per guides.
- **`ActiveRecord::UnknownMigrationVersionError`**: Raised when `VERSION=` targets a non-existent migration (example in guides for all-zero version).
- **Re-run no-op after edit**: If a migration was already recorded in `schema_migrations`, editing the file alone does not re-execute; operator must rollback then migrate (guides).

### Identities / addressing

- **How are migrations identified?** Primarily by the **numeric version prefix** in the filename (`YYYYMMDDHHMMSS` by default). The CamelCase class name is expected to match the descriptive suffix. Optional configuration: `config.active_record.timestamped_migrations = false` switches to numeric prefixes; `config.active_record.validate_migration_timestamps = true` validates expected timestamp format.
- **How are environments / branches addressed?** Environments via `RAILS_ENV=…` on CLI tasks. Branches are not modeled in the DB: collaboration relies on VCS ordering and regenerating schema dumps after merges.
- **How does the database track which migrations have run?** One row per applied version in **`schema_migrations.version`**. Guides position the live database as truth; the dump file carries a `version:` field matching the latest applied migration for Ruby schema format.

## CLI command surface

Commands below use the `bin/rails db:…` / `bin/rails generate …` style from the guides; `rails` is an equivalent prefix in many setups.

### Create / scaffold

- **`bin/rails generate migration Name`**: **generate** — create an empty timestamped migration file.
- **`bin/rails generate migration CreateProducts cols…`**: **generate** — scaffold `create_table` from `Create*` naming plus column arguments.
- **`bin/rails generate migration AddXToY …` / `RemoveXFromY`**: **generate** — scaffold `add_column` / `remove_column` via name patterns.
- **`bin/rails generate migration … references|belongs_to`**: **generate** — scaffold `add_reference`-style foreign key columns.
- **`bin/rails generate migration CreateJoinTableUserProduct …`**: **generate** — scaffold `create_join_table`.
- **`bin/rails generate model` / `resource` / `scaffold`**: **generate** — create model-related files including an appropriate migration.
- **`bin/rails generate migration --help` / `bin/rails generate model --help`**: **help** — document naming conventions and column syntax for generators.

### Apply / change database shape

- **`bin/rails db:migrate`**: **migrate** — apply all pending migrations in order; dumps schema afterward.
- **`bin/rails db:migrate VERSION=YYYYMMDDHHMMSS`**: **migrate** — move forward or backward along the timeline until before/including the given version per rules in the guide.
- **`bin/rails db:migrate:up VERSION=…`**: **migrate up** — run a single migration’s `change`/`up` if not already recorded.
- **`bin/rails db:migrate:down VERSION=…`**: **migrate down** — run a single migration’s `down`/reverse `change` if applied.
- **`bin/rails db:migrate:redo STEP=n`**: **redo** — rollback `STEP` migrations then migrate forward again (convenience around edit cycles).
- **`bin/rails db:migrate:reset`**: **reset via migrations** — drop and recreate DB by replaying the whole migration chain (differs from `db:reset`).
- **`bin/rails db:setup`**: **setup** — create DB, load schema, run seeds.
- **`bin/rails db:prepare`**: **prepare** — idempotent setup: create if missing; if DB exists without tables, load schema, run pending migrations, dump schema, seed (subject to seeds configuration notes in the guide).
- **`bin/rails db:schema:load`**: **load schema** — build structure from `db/schema.rb` or `db/structure.sql` without running migrations.
- **`bin/rails db:schema:dump`**: **dump schema** — write current DB structure to the configured schema file (also chained from migrate).

### Inspect / introspect

- **`bin/rails db:migrate:status`**: **status** — list each migration version with **up/down** and flag missing files.
- **`bin/rails dbconsole` / SQL on `schema_migrations`**: **inspect** — operator-level verification of applied versions (shown in guide examples).

### Rollback / teardown helpers

- **`bin/rails db:rollback`**: **rollback** — reverse the latest migration.
- **`bin/rails db:rollback STEP=n`**: **rollback** — reverse the last `n` migrations.
- **`bin/rails db:reset`**: **reset** — `db:drop` + `db:setup` equivalent using current schema file (not full migration replay).
- **`bin/rails db:drop`**: **drop** — remove database (paired with other tasks in reset flows; implied by `db:reset` description).

### Seeds / auxiliary (touches migration workflow)

- **`bin/rails db:seed`**: **seed** — run `db/seeds.rb` after setup flows.
- **`bin/rails db:seed:replant`**: **replant seeds** — reload seed data when `db:prepare` will not re-seed automatically.

### Output control

- **`bin/rails db:migrate VERBOSE=false`**: **silence** — suppress migration progress output.

## Distinctive vocabulary choices

- **`change` vs explicit `up`/`down`**: A single forward body whose inverse is synthesized for many operations, instead of always authoring paired methods.
- **`reversible` / `revert`**: First-class words for partial or full programmatic inversion, including embedding inverse of an earlier migration class by reference.
- **`VERSION=` and `STEP=`**: Migration targeting expressed as env-style task parameters rather than subcommand names.
- **`schema_migrations` ledger**: Applied migrations tracked as rows of version strings, decoupled from file checksums.
- **Dual artifacts (migrations + dump)**: Parallel concepts—“migration history” vs “schema snapshot” (`schema.rb` / `structure.sql`) with different roles in `setup`/`reset`/`prepare`.
- **`db:prepare` idempotency language**: Explicit framing of a safe repeated entrypoint distinct from one-shot `db:setup`.
- **`db:migrate:status` “NO FILE”**: Operational visibility when the filesystem history and DB ledger diverge after deleting migrations.
- **Engine migration provenance comments**: Copied migrations carry textual trace (`# This migration comes from … (originally …)`), encoding redistribution rather than a single canonical path.
- **`db:reset` vs `db:migrate:reset` contrast**: Docs name two “reset” stories—reload from schema dump vs replay migration files—with different failure and drift implications.
- **`IrreversibleMigration` as control flow**: A named exception type used both by authors and by the framework when moving `down` cannot be inferred.
- **Generator name physics**: Timestamp prepended automatically; manual copying warned because sort order depends on the numeric prefix.
- **“Version of the database” metaphor**: Guides describe each migration informally as a new database version while the machinery remains file order + ledger rows.
- **`dbconsole` as migration observability**: The SQL console is presented as a legitimate way to read `schema_migrations`, not only application data.
- **Schema format switch (`:ruby` vs `:sql`)**: Vocabulary treats the dump format as a product decision with fidelity trade-offs, not an implementation detail.
- **`change_column` irreversibility call-out**: Docs explicitly label some helpers as non-reversible unless wrapped, shaping how authors talk about “safe rollback”.
- **Maintenance-task ecosystem**: The “Data Migrations” section names external gems (e.g. `maintenance_tasks`) as the vocabulary for long-running data work outside migrations.

## What this system's vocabulary makes easy / hard

- **Easy**: Expressing a **monotonic, ordered sequence** of schema edits with quick local **undo/redo** (`rollback`, `migrate:redo`) and a clear **applied vs pending** distinction grounded in `schema_migrations`.
- **Hard**: Treating migrations as a **purely reproducible, content-addressed** history over long horizons—guides highlight failures when replaying old migrations that depend on evolving application code or external state, pushing teams toward **schema loads** and forward-only correction migrations instead of rewriting past versions.

---

## See also

- [`../../10-domains/migration/`](../../10-domains/migration/) — the Prisma 8 migration domain model, which builds on the conventions surveyed here.
- [`./README.md`](./README.md) — index of migration-system inspirations with one-line takeaways per system.
