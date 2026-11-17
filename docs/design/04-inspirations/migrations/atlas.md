# Atlas

> Atlas is a language-agnostic CLI and project model for database schema management that supports both declarative (state-based) planning/apply and versioned (change-based) migration directories, unified around URLs as load carriers for targets, sources, and migration artifacts.

## Mental model

Atlas splits work into two first-class workflows that can be combined. In **declarative** mode, the user supplies a **desired state** (HCL or SQL schema files, another database URL, ORM-fed external schema, or even a migration directory interpreted as state); Atlas **inspects** the target’s **current state**, **diffs** the two, and **plans/applies** a transition—optionally after lint-driven **review policy** gates—often using a **dev database** URL so the engine can materialize and validate schemas the same way a real DB would. In **versioned** mode, the canonical artifact is an ordered **migration directory** of SQL files plus an **integrity file** (`atlas.sum`); **current state** for authoring is commonly derived by **replaying** the directory onto a dev database, diffing that against the desired schema, and appending a new versioned file. **Identity** for versioned units is the migration file’s **version** (timestamp prefix by default) and the checksum graph in `atlas.sum`; **identity** for “what ran” on a target is persisted in **`atlas_schema_revisions`** (revision rows), with optional **baseline** and **allow-dirty** semantics when adopting existing databases. **Environments** are addressed primarily by **database URLs** (driver, host, database/schema scope) and extended schemes (`file://`, `atlas://`, `docker://`, `env://`, `ent://`) that treat locations as interchangeable inputs to the same verbs.

Atlas documents a **hybrid** cadence: developers iterate locally with **`atlas schema apply`** against disposable targets for speed, then freeze intent for shared environments by running **`atlas migrate diff`** so the engine writes the same transition as a durable SQL file checked into version control. That makes the **migration file** the audit artifact while the **HCL/SQL/ORM URL** remains the ergonomic authoring surface. Cross-cutting concerns—multi-schema scope, identifier qualification, destructive DDL policy, concurrent index rules—are expressed once in **`atlas.hcl`** (diff/migration/review blocks) and reused across both workflows, so “policy” and “location” stay orthogonal to “declarative vs versioned.”

## Vocabulary

### Nouns

- **Atlas CLI / project file**: the `atlas` command-line tool and optional `atlas.hcl` project configuration (`env`, `migration`, `lint`, `diff`, `docker`/`dev` blocks, etc.) that names URLs, policies, and formatting.
- **Desired state**: the schema definition Atlas should converge to—HCL (`*.hcl`), SQL (`*.sql` or directory), live DB URL, ORM-backed external schema, or a migration directory URL (with optional `format` and `version` query parameters) treated as a schema snapshot.
- **Current state**: the schema Atlas reads from a target database URL or, for versioned authoring, the state obtained by applying the migration directory up to a chosen version on a dev database.
- **Declarative schema migration / state-based migration**: workflow where Atlas plans SQL to move a DB from current to desired without hand-written forward scripts as the primary artifact; centered on `atlas schema apply` / `atlas schema plan`.
- **Versioned migration / change-based migration**: workflow where explicit ordered SQL files are the reviewed, deployed unit of change; centered on `atlas migrate diff` / `atlas migrate apply`.
- **Versioned migration authoring**: Atlas’s term for generating versioned SQL from a declarative desired state while decoupling planning from execution (diff into files, then standard versioned pipeline).
- **Migration directory**: folder of versioned SQL migration files (default URL `file://migrations`) plus integrity metadata; may target alternate on-disk layouts (`golang-migrate`, `goose`, `flyway`, `liquibase`, `dbmate`) via `format` query parameter or `migration.format` in config.
- **Migration file / version**: typically `{{timestamp}}_{{name}}.sql` under the default Atlas format; `version` identifies a specific file in ordering and in directory URLs (`?version=…`).
- **Integrity file (`atlas.sum`)**: migration directory integrity manifest listing per-file hashes and an aggregate checksum using a reverse one-branch Merkle structure; intended to force VCS merge conflicts when parallel branches add migrations.
- **Dev database (`--dev-url`)**: ephemeral or disposable database (commonly `docker://…`) used to compile/validate HCL/SQL, normalize forms, simulate migrations, and compute diffs safely away from production.
- **Baseline schema (dev database)**: optional SQL/HCL applied to a dev container or empty dev URL before Atlas runs computations—used when schemas depend on extensions, external functions, or other unmanaged objects.
- **Baseline (migrate apply)**: version string passed to first `atlas migrate apply` so Atlas marks that migration revision as already applied and continues with later versions when adopting an existing database.
- **Allow-dirty**: flag allowing first apply against a non-empty database that is not fully described by Atlas migrations (distinct from baseline, which still snapshots schema into a starting file).
- **Schema revision / revisions table (`atlas_schema_revisions`)**: table Atlas maintains on the target catalog/schema recording applied migration versions, execution metadata, and (with certain transaction modes) per-statement progress for resume semantics.
- **Revisions schema**: optional schema/name for storing `atlas_schema_revisions` when the connection URL is not schema-scoped.
- **Pre-planned migration / plan (declarative)**: stored schema transition plan (Atlas Registry / CI integrations) matched by **schema state transition** rather than database URL, optionally skipping interactive approval when policy allows.
- **Review policy / lint diagnostics**: configuration tying declarative approval to severity of static analysis results (`ERROR`, `WARNING`, `ALWAYS`) from Atlas’s analysis engine over proposed transitions.
- **Diff policy**: project-level knobs influencing generated DDL (e.g., skip destructive drops, concurrent index behavior) for both declarative apply and versioned diff outputs.
- **Transaction mode (`--tx-mode`, `atlas:txmode` directive)**: `file` (per migration file), `all`, or `none` wrapping of pending SQL; file-level overrides for statements like `CREATE INDEX CONCURRENTLY`.
- **Execution order (`--exec-order`)**: `linear` (strict ordering vs recorded DB version), `linear-skip` (skip older pending files), or `non-linear` (discouraged) when resolving out-of-order additions.
- **Target URL (`--url`, `-u`)**: database connection URL; schema qualification in the URL controls whether Atlas emits qualified or unqualified identifiers in DDL.
- **Migration directory URL (`--dir`)**: `file://` path or `atlas://` remote directory in Atlas Cloud / registry, optionally with `tag` for immutable deploy pins.
- **Deployment / rollout (multi-tenant)**: HCL `deployment` grouping with parallelism and dependency stages for applying changes across many tenant URLs from one `env` expansion.
- **Down migration**: user-authored rollback SQL companion pattern in other tools; Atlas still treats history as roll-forward but offers `atlas migrate down` for controlled reversal scenarios (separate doc surface).
- **Atlas Registry / Schema Registry / migrations artifact**: remote `atlas://` slug representing pushed migration directory state, analogous to an image registry in docs’ analogy.
- **Atlas DDL / HCL schema**: Atlas’s structured schema language (`*.hcl`) used interchangeably with SQL schema files in docs as a carrier for desired state; serializes to forms the engine can diff canonically.
- **SQL schema (desired-state file)**: `CREATE`/`ALTER`-oriented SQL file or directory consumed as desired state input to `schema apply` / `migrate diff`.
- **External schema / ORM bridge**: `data "external_schema"` (or provider CLIs) feeding a URL that appears wherever a schema URL is accepted—docs show Sequelize and other ORM loaders emitting schema for `--to` / `env.src`.
- **`--to` / `--from` endpoints**: directional arguments in diff/apply commands; `--to` almost always means “desired,” `--from` (where present) means “starting side” for comparisons (e.g., drifted production vs migration dir snapshot).
- **Format template (`--format`)**: Go `text/template` hooks controlling emitted SQL spacing (`{{ sql . "  " }}`) or JSON shaping for CI consumers.
- **`--edit` (declarative apply)**: opens generated plan in an editor before execution so operators can tweak SQL while staying inside the approval flow.
- **`--dry-run`**: prints pending SQL without mutating the target (migrate apply); may still execute pre-migration checks when configured.
- **`--auto-approve`**: bypass interactive confirmation for `schema apply`—documented as unsafe for production defaults.
- **Qualifier (`--qualifier`)**: forces schema/database qualifiers in emitted migration SQL when working in multi-schema mode with specific naming needs.
- **Exclude / include globs**: resource selectors for inspection and migration authoring (`--exclude`, `--include`) that filter object kinds (tables, extensions, policies) using typed selectors like `[type=partition]`.
- **Analyzer / analysis engine**: named lint checks (e.g., destructive changes, data-dependent migrations) powering both `migrate lint` and declarative review policies.
- **Pre-migration checks / deployment hooks**: versioned-doc surface for SQL checks and pre/post deployment scripts executed around applies (paired with hooks in `atlas.hcl` for session settings).
- **Migration hooks (`hook` blocks)**: transactional SQL snippets injected around migration transactions (e.g., timeouts) configured per environment.
- **`check` blocks (Pro migrate apply)**: declarative policy DSL referencing `self.planned_migration.files` / `.statements` evaluated before any migration executes.
- **Advisory lock (`--lock-name`)**: concurrency guard during `migrate apply`, default name `atlas_migrate_execute`, customizable when multiple apps share a server catalog.
- **Schema drift**: live database diverged from migration files; docs prescribe `schema diff` / `schema apply` against `file://migrations?version=…` as reconciliation tools while keeping files authoritative.
- **Planned migration object**: runtime view of pending statements/files exposed to policy hooks and lint summaries.
- **Workspace / cloud project (colloquial in tutorials)**: Atlas Cloud account plus named migration directory slug used after `migrate push`.

### Verbs

- **Inspect (`atlas schema inspect`)**: read current database schema and emit HCL, SQL, JSON, or visual forms; supports include/exclude glob patterns for object sets.
- **Diff (`atlas schema diff`, `atlas migrate diff`)**: compute SQL needed from a `from` state to a `to` state—either printing (`schema diff`) or writing a new migration file into a directory (`migrate diff`).
- **Apply (`atlas schema apply`, `atlas migrate apply`)**: execute planned DDL—declaratively against a live URL after approval/review policy, or by running pending versioned files in order (optional numeric limit for count of files).
- **Plan (`atlas schema plan`)**: produce/review declarative plans out-of-band of apply, often integrated with CI, to satisfy governance before `schema apply`.
- **Lint (`atlas migrate lint`, analysis in declarative review)**: static/dynamic checks on migration files or proposed transitions (destructive changes, data-dependent constraints, non-linear history, etc.).
- **Hash (`atlas migrate hash`)**: recompute `atlas.sum` after legitimate edits to migration files (e.g., post-fix) so integrity metadata matches directory contents.
- **Validate (implicit via dev database)**: materialize schema/migrations on dev DB to catch engine-specific errors (invalid check expressions, canonicalization drift) before touching targets.
- **Push (`atlas migrate push`)**: upload migration directory state to remote `atlas://` registry for CD consumption without local git checkout.
- **Status (`atlas migrate status`, `atlas schema status`)**: summarize migration progress / versions for troubleshooting; `migrate status` explicitly does not list attempts fully rolled back inside transactional DDL.
- **Rebase (`atlas migrate rebase`)**: repair ordering when out-of-order files are detected relative to `atlas_schema_revisions`, preparing a linear history again.
- **Set (`atlas migrate set`)**: adjust revision bookkeeping when operators manually align database reality with migration files (dangerous if misused).
- **Clean (`atlas schema clean`)**: reset schema to empty baseline in dev-focused recovery flows (paired cautiously with non-linear local fixes).
- **Login (`atlas login`)**: authenticate for Atlas Cloud/Pro capabilities (remote dirs, advanced inspection, analysis in review).
- **Approve (human / policy / registry)**: tri-state outcome for declarative plans—manual y/n in CLI, automatic when lint severity passes configured threshold, or external approval for stored plans / ad-hoc registry workflows.
- **Export (`atlas schema inspect --export`, Pro)**: drive configured exporters (SQL split-by-object, HTTP, etc.) after inspection for downstream artifacts.

### Events / lifecycle states

- **Planned changes / migration plan**: intermediate SQL batch shown for human or policy approval before execution.
- **Pending (migration vs database)**: registry/UI state where new migrations exist remotely or in directory but `atlas_schema_revisions` on a DB has not caught up (tutorial language).
- **In sync**: database migration history matches the migration directory’s latest applied version in docs’ deployment reporting.
- **Pending execution queue**: ordered list of migration files not yet recorded in `atlas_schema_revisions` for the target scope.
- **Partial execution / resume**: with `--tx-mode none` or after certain failures, Atlas tracks last successful statement to continue within a file; caution around non-transactional DDL engines.
- **Out-of-order / non-linear history error**: runtime guard when new file versions sort before the DB’s recorded head under `linear` execution order.
- **Ad-hoc plan / approval**: when no pre-approved declarative plan matches a divergent live database, Atlas can create a registry-linked plan and wait for explicit approval per review policy table in `schema apply` docs.
- **Rolled-back migration attempt (transactional DDL)**: failed `migrate apply` inside a transaction may leave no durable footprint in `atlas_schema_revisions`; `migrate status` omits these attempts by design.
- **Unclean / dirty database (first apply)**: target already contains objects not described by migrations; Atlas blocks until `--baseline` or `--allow-dirty` semantics apply.
- **Syntax / semantics / data-dependent failure classes**: troubleshooting taxonomy—lint is expected to catch syntax; drift vs bad file vs constraint violations each imply different remediation verbs (`hash`, `schema apply`, data fix SQL).
- **Connection-loss mid-migration**: event where Atlas retries from last persisted statement boundary; rare edge cases called out when statement commits but revision row does not.
- **Directory out-of-sync with cloud prompt**: CI/CLI warning when local migrations lag Atlas Cloud’s latest pushed versions—forces pull/rebase decision before generating new diffs.

### Identities / addressing

- **Migration files**: default lexicographic ordering by leading timestamp/version token in filename; integrity enforced by companion `atlas.sum` mapping each filename to an `h1:` content hash plus a rolled-up root hash so parallel edits collide in VCS.
- **Environments**: expressed as URLs—`postgres://…?search_path=…` vs whole-database scope changes qualifier behavior; `file://` for schemas/migrations; `atlas://slug?tag=` for immutable remote sets; `docker://image/version/db` for ephemeral dev instances; `env://` indirection from `atlas.hcl` data sources; `ent://` for Ent schemas.
- **Applied migration tracking**: rows in `atlas_schema_revisions` scoped to the connection’s schema, or dedicated `atlas_schema_revisions` schema when URL is global, optionally relocated via `--revisions-schema`.
- **`atlas.sum` mechanism**: automatically updated when migrations are generated; merging two branches both adding files typically conflicts on `atlas.sum`, forcing sequentialization (`migrate rebase`) and `migrate hash` after conflict resolution—operationalizing “linear history” as a VCS-visible invariant.
- **Database URL grammar**: `driver://[user[:pass]@]host[:port]/[db|schema][?params]` with driver-specific query keys (`sslmode`, `search_path`, `tls`, etc.); passwords may be wrapped via `urlescape` helpers in `atlas.hcl`.
- **`file://` directory semantics**: can reference schema dirs, single `.sql`/`.hcl` files, or migration roots; optional `?format=` and `?version=` on migration dirs pin interpretation when diffing/applying.
- **`atlas://` query parameters**: `version` pins a specific migration file as head; `tag` pins content-addressed states for deploy reproducibility.
- **Multi-tenant URL expansion**: `for_each` on `env` blocks combined with `urlsetpath` / `urlqueryset` functions encodes how tenant identity maps into distinct targets without new CLI verbs.
- **Docker dev URLs**: encode engine image, logical database name, and sometimes `search_path` to signal single-schema vs multi-schema diff behavior.

**Note on canonical URLs in this memo:** user-facing docs referenced `https://atlasgo.io/reference` (HTTP 404) and `https://atlasgo.io/versioned/status` (HTTP 404) at fetch time; equivalent material appeared under `https://atlasgo.io/cli-reference` and within `https://atlasgo.io/versioned/apply` plus `https://atlasgo.io/versioned/troubleshoot` for `atlas migrate status`.

## CLI command surface

**Schema / declarative workflow**

- `atlas schema inspect` — emit current schema from a database URL.
- `atlas schema apply` — plan and apply declarative transition from `--url` to `--to` with optional `--dev-url`, review, and diff policies.
- `atlas schema plan` — author/store declarative plans for CI-approved transitions consumed later by apply.
- `atlas schema diff` — print SQL diff between two states (live DB, file, migration dir with `version`, etc.) without applying.
- `atlas schema status` — report applied migration version context when reconciling drift (per troubleshooting guides).
- `atlas schema clean` — destructive reset helper for dev recovery paths.

**Migrate / versioned workflow**

- `atlas migrate diff` — append a new SQL migration after diffing replayed directory state vs desired schema using `--dev-url`.
- `atlas migrate apply` — execute pending migrations against `--url` from `--dir` (local `file://` or remote `atlas://`), with batching, transaction, execution-order, baseline, and dry-run controls.
- `atlas migrate lint` — analyze migration directory for safety, style, and linear-history constraints in CI.
- `atlas migrate status` — show depth of pending/applied migrations and diagnostic summary for a target.
- `atlas migrate hash` — refresh `atlas.sum` after manual file edits.
- `atlas migrate push` — publish directory contents to Atlas registry slug.
- `atlas migrate rebase` — rewrite/repair ordering for out-of-order version files before merge.
- `atlas migrate down` — controlled rollback path paired with down SQL conventions (separate detailed doc).
- `atlas migrate set` — surgically adjust revision metadata when operators manually reconcile reality.

**Session / platform**

- `atlas login` — establish cloud session for registry-backed dirs and Pro analysis features.
- `atlas tool docker` (and related `docker` driver URLs) — spin ephemeral engine instances used as dev databases.

The full command tree—including import helpers, provider utilities, and ancillary subcommands—lives in Atlas’s CLI reference (`https://atlasgo.io/cli-reference`). The grouping above is limited to the verbs Atlas’s own declarative/versioned comparison page highlights as the backbone of day-to-day schema work.

## Distinctive vocabulary choices

- **Desired state vs current state** as explicit poles for every diff/plan operation, regardless of whether the next step is declarative apply or versioned file emission.
- **Dev database as a compilation target**—not merely “a local DB,” but a required sandbox for honest diffing/normalization across heterogeneous engines.
- **URL scheme polymorphism**—the same `--to`, `--from`, `--dir`, and `--url` flags accept DBs, files, docker descriptors, cloud registry slugs, and indirections (`env://`), making “location” a first-class typed value.
- **Versioned migration authoring** as a named bridge pattern: declarative inputs, versioned outputs, shared review/audit properties.
- **`atlas.sum` + Merkle wording**—integrity is part of the domain model, not an implementation detail, because it encodes team concurrency rules.
- **Split verbs: `schema apply` vs `migrate apply`**—clear linguistic boundary between “engine moves DB now” vs “replay checked-in scripts.”
- **Baseline dual meaning**—dev baseline schema vs migrate baseline version flag—same word for “starting truth” in different planes (compute vs bookkeeping).
- **Execution-order vocabulary (`linear`, `linear-skip`, `non-linear`)**—first-class modeling of VCS ordering hazards rather than assuming timestamps always work.
- **`--config` / `--env`**: standard mechanism for selecting named `atlas.hcl` environments so the same CLI verbs run against different URL triples (`url`, `src`/`to`, `dev`, `migration.dir`) without respecifying flags.
- **`--var`**: dynamic inputs into `atlas.hcl` variables (e.g., toggling destructive diff policy per invocation).

## What this system's vocabulary makes easy / hard

- **Easy**: Expressing heterogeneous sources of truth (HCL, SQL, live DB, ORM, migration-dir-as-state) through one URL-typed algebra and a small set of diff/apply verbs; enforcing collaborative linear migration history via `atlas.sum` merge conflicts; combining fast local declarative iteration with reviewable versioned artifacts for shared environments.
- **Hard**: Situations where engines lack transactional DDL or implicit commits break the coupling between physical schema and `atlas_schema_revisions`, requiring operator intervention (`migrate set`, manual fixes, `migrate hash`); explaining and safely using overlapping “baseline” concepts across dev setup vs first production apply without conflating semantics.

Atlas’s own docs call out additional operational pressures—MySQL implicit commits, partial statement progress without transactions, and merge skew between local directories and Atlas Cloud—that are not new nouns but explain why the vocabulary includes parallel concepts (`hash`, `rebase`, `set`, `schema clean`) for recovery rather than only happy-path verbs.

---

## See also

- [`../../10-domains/migration/`](../../10-domains/migration/) — the Prisma 8 migration domain model, which builds on the conventions surveyed here.
- [`./README.md`](./README.md) — index of migration-system inspirations with one-line takeaways per system.
