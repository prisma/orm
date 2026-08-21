# Error reference

Every user-facing Prisma Next error is a structured envelope identified by a dotted `NAMESPACE.SUBCODE` code (see [ADR 239](../architecture%20docs/adrs/ADR%20239%20-%20Errors%20are%20structural%20envelopes%20with%20dotted%20namespace%20codes.md) and [Error Handling](../Error%20Handling.md)). This page lists every published code. It is the canonical source for the hosted reference at `https://docs.prisma.io/docs/orm/next/reference/error-reference` (each code anchors as `#<CODE>`; the `next` segment flips to `v8` at RC), and CI verifies completeness on every PR: `pnpm check:error-reference` fails if any code in production source is missing from this page.

Recognize an error programmatically with `isStructuredError` from `@internal/utils/structured-error` and match on `error.code` — never `instanceof`. Envelopes carry `message`, and optionally `why`, `fix`, `where`, `meta`, `cause`, and `docsUrl`.

Exit codes (CLI): an expected structured failure exits `2`, a user abort exits `3`, and `1` is reserved for internal errors (bugs). Codes on this page exit `2` unless the entry says otherwise.

Some codes are not failures to run at all. `db verify`, `db sign` and `migration check` answer a question about the project, and a bad answer is still an answer: they finish, report their findings as diagnostics on a successful envelope, and exit `4`. Exit `2` is reserved for the cases where those commands could not do the job — an unknown `--space`, a migration reference that resolves to nothing, an unreachable database, a contract that has not been emitted. Every entry whose code can arrive on one of those runs says so and names the command. Each of those commands declares the numbers it can exit with, and its `--help` text spells out what each one means.

A command may also **complete with findings**: it ran to its end and has a result to report, and the problems it found ride that result as diagnostics carrying the codes on this page. Those runs exit with a documented per-command code in the `4`–`99` band rather than `2`, and the entry below says so. `prisma orm init` is the case today: its scaffold is on disk whatever happens next, so a failed dependency install or contract emit is a finding on a completed run at exit `4` or `5`.

Codes that predate the dotted scheme were renamed at 0.16; the full old→new crosswalk (`PN-DOMAIN-NNNN` → `NAMESPACE.SUBCODE`) is in [ADR 239](../architecture%20docs/adrs/ADR%20239%20-%20Errors%20are%20structural%20envelopes%20with%20dotted%20namespace%20codes.md).

Namespaces:

| Namespace | Covers |
|---|---|
| `CONFIG` | Loading and validating `prisma.config.ts` |
| `CLI` | Command-line argument and invocation errors |
| `CONTRACT` | Contract authoring, emission, validation, and the contract↔database relationship (markers, schema verification) |
| `PSL` | The PSL source text itself (parse/format) |
| `ORM` | ORM client and query-builder DSL API misuse |
| `RUNTIME` | Query execution and runtime wiring |
| `DRIVER` | Database driver connection and protocol failures |
| `MIGRATION` | Migration authoring, planning, checking, and execution |
| `PLAN` | Query plan constraints |
| `BUDGET` | Query budget violations |
| `LINT` | Query lint findings |
| `PARADEDB` | ParadeDB extension: search-function arguments |
| `POSTGIS` | PostGIS extension: geometry construction and validation |
| `SUPABASE` | Supabase extension: config wiring and JWT handling |

## CONFIG

### CONFIG.CONTRACT_MISSING

The `contract` section is missing (or incomplete) in `prisma.config.ts` when a command needs it — raised by `prisma contract emit` when the config has no contract configuration, no schema path, or the referenced authoring entrypoint cannot be resolved. Meta: none.

### CONFIG.DB_CONNECTION_REQUIRED

A DB-connected command (`migrate`, `db init`, `db sign`, `db verify`, `db update`, `inspect-live-schema`, and the migration scaffold commands) was run with no database connection available — no `--db <url>` flag and no `db.connection` in `prisma.config.ts`. The fix text names the exact retry command when known. Meta: `missingFlags` (optional).

### CONFIG.DRIVER_REQUIRED

A DB-connected command was run but `prisma.config.ts` has no control-plane `driver` entry (e.g. `driver: postgresDriver`). Raised by the migration command scaffold, `migrate`, `db sign`, `db verify`, and `inspect-live-schema`. Meta: none.

### CONFIG.EVALUATION_FAILED

The config module could not be evaluated at all — a syntax error in `prisma.config.ts`, or the module threw during import. Raised by the config loader for any command that needs config; loading fails outright (no per-section diagnostics are possible for a module that does not evaluate) and every command exits `2` with this error. The underlying evaluation error's message is carried in `why` and the original error in `cause` (in-process only). The path, when known, is carried in `where.path`. Meta: none.

### CONFIG.FAMILY_READ_MARKER_REQUIRED

Reserved: `db verify` needs the family package to export `verify.readMarker()` and it is absent. Declared in the shared error factories but not raised by any command today.

### CONFIG.FILE_NOT_FOUND

No `prisma.config.ts` (or the explicitly passed config path) could be found when loading configuration — raised by the config loader for any command that needs config. The fix is to run `prisma orm init` to create one. The path, when known, is carried in `where.path`. Meta: none.

### CONFIG.MISSING_EXTENSION_PACKS

The contract declares extension packs that the CLI config does not provide matching descriptors for; raised when resolving framework components for any command that loads the contract. The fix is to add the missing extension descriptors to `extensions` in `prisma.config.ts`. Meta: `missingExtensionPacks`, `providedComponentIds`.

### CONFIG.QUERY_RUNNER_FACTORY_REQUIRED

Reserved: `db verify` needs `db.queryRunnerFactory` in `prisma.config.ts` and it is absent. Declared in the shared error factories but not raised by any command today.

### CONFIG.VALIDATION_FAILED

`prisma.config.ts` loaded but a config section is missing or malformed. The config loader validates the evaluated config and returns one diagnostic per problem, each tagged with the top-level config section it concerns (`meta.section`: `family`, `target`, `adapter`, `driver`, `extensions`, `db`, `contract`, `migrations`, or `formatter`); a command fails with the diagnostic (exit `2`) only when it reads that section. Also raised by framework-component resolution for fields like `frameworkComponents[]`, `frameworkComponents[].kind`/`familyId`/`targetId`, `contract.targetFamily`, and `contract.target`, and by contract-path resolution when `config.contract.output` is absent (those sites carry no `section`). Meta: `field` (loader diagnostics), `section` (loader diagnostics; optional elsewhere).

### CONFIG.VERSION_MARKER_MISSING

The config module evaluated, but its default export was not created by the current `defineConfig` — a plain object export, a spread copy of a `defineConfig` result, or a config produced by a different `defineConfig` (for example a classic Prisma 7 config file). Raised by the config loader before validation; loading fails outright and every command exits `2` with this error. The fix is to create the config with `defineConfig` (imported from your target package's `/config` entrypoint, for example `@prisma/orm-postgres/config`) and export its return value directly. The path, when known, is carried in `where.path`. Meta: none.

## CLI

### CLI.CONFIG_ARG_MISSING_PATH

The migration-file CLI (`prisma migration`) received `--config` without a path argument — either a bare trailing `--config`, or `--config` immediately followed by another flag (e.g. `--config --dry-run`). The CLI fails fast instead of consuming the next flag as the config path or silently falling back to default config discovery. Meta: `nextToken` (present only when another flag followed `--config`).

### CLI.CONSENT_OPERATIONS_MISSING

`db update` was told the plan is destructive but was given no operations to name, so the consent prompt would have asked you to authorise a list of nothing. The command refuses instead of prompting. This is an inconsistency between the CLI and the control API rather than something your project can be wrong about; run `prisma db update --dry-run` to see the plan, and report the run. Meta: none.

### CLI.CONSENT_TOKEN_UNRESOLVED

`db update` could not derive a name for the database it is about to change, so there is nothing for the consent prompt to ask you to type — and an empty token would let a bare Enter (or `--confirm ""`) authorise data loss. The name comes from the `database` a driver connection object carries, or from the connection URL (its first path segment, else its host), falling back to the target id. Name the database in `db.connection` or pass `--db <url>`. Meta: none.

### CLI.CONTRACT_ARG_CONFLICT

`prisma db sign` was given a contract reference twice — once as the positional argument and once as `--contract` — and there is no rule for which one wins. Pass it once. Meta: `positional`, `flag`.

### CLI.FILE_NOT_FOUND

A file the command needs does not exist at the given path. Produced by several commands: the migration command scaffold, `migrate`, `migration plan`, `migration show`, `db sign`, `db update`, `db verify`, and `ref` all raise it when the emitted `contract.json` (or another required file) is missing from the expected location. Most sites carry the path in `where.path`; the `migration new` contract-file site carries it in the summary text only. Meta: none.

### CLI.FILE_WRITE_FAILED

Writing a file failed — currently raised when `format` cannot write the formatted PSL source back to disk (e.g. the file is not writable). The underlying failure is attached as `cause`. Meta: none.

### CLI.INIT_AUTHORING_SCHEMA_PATH_MISMATCH

During `prisma orm init`, `--authoring` and `--schema-path` disagree on file extension — for example `--authoring psl` with a schema path ending in `.ts`. Raised before any scaffold files are written, so the project tree stays untouched. Meta: `authoring`, `schemaPath`, `actualExtension`, `expectedExtension`.

### CLI.INIT_EMIT_FAILED

During `prisma orm init`, the `prisma contract emit` step failed after a successful dependency install. Scaffolded files and installed dependencies remain on disk; the user fixes the contract file and re-runs the emit command. `init` completes with this as a finding and exits 5. Meta: `filesWritten`, `cause`.

### CLI.INIT_INSTALL_FAILED

During `prisma orm init`, dependency installation failed and the pnpm-to-npm fallback either did not apply or also failed. Files scaffolded before the install step are already on disk; the next actions carry the install command that was attempted and the emit that was waiting on it. `init` completes with this as a finding and exits 4. Meta: `filesWritten`, plus `install` (the attempted command, the manager, its exit code and the tail of its stderr).

### CLI.INIT_INVALID_FLAG_VALUE

A flag passed to `prisma orm init` has a value outside its allowed set (for example `--target` with something other than `postgres` or `mongodb`). Maps to init exit code 2 (PRECONDITION). Meta: `flag`, `value`, `allowed`.

### CLI.INIT_INVALID_MANIFEST

`prisma orm init` could not parse the project's `package.json` as JSON. Init reads the manifest to merge scripts and to skip `@types/node` when already declared, so a malformed file is a hard precondition failure the user can fix and re-run. Maps to init exit code 2 (PRECONDITION). Meta: `path`, `cause`.

### CLI.INIT_INVALID_OUTPUT_DOCUMENT

`prisma orm init` completed but its own success output document failed schema validation. This indicates a bug in Prisma Next itself, not user error. The engine-hosted `init` settles it as an errored envelope at exit 2 (the commander `init`, deleted in the S5 cutover, mapped it to exit 1), because the ORM's error boundary converts every failure into a structured settlement and the engine reserves exit 1 for a throw that reaches it uncaught. Meta: none.

### CLI.INIT_INVALID_TSCONFIG

`prisma orm init` could not parse the project's existing `tsconfig.json`, even with JSONC tolerance (comments and trailing commas). Init merges required compiler options into it, so an unreadable file blocks the run; raised before any scaffold file is written. Maps to init exit code 2 (PRECONDITION). Meta: `path`, `cause`.

### CLI.INIT_MISSING_FLAGS

`prisma orm init` ran non-interactively (e.g. `--yes`, or stdin is not a TTY) but one or more required inputs (`--target`, `--authoring`, `--schema-path`) were not supplied as flags. Every missing flag is listed so scripts and agents can react without parsing English. Maps to init exit code 2 (PRECONDITION). Meta: `missingFlags`.

### CLI.INIT_PROBE_FAILED

`prisma orm init --probe-db --strict-probe` was run and the database probe could not complete (no `DATABASE_URL`, network or auth error, driver not installed). Without `--strict-probe` these surface as warnings; strict mode escalates them to fatal. Scaffolded files are already on disk when this fires. Maps to init exit code 2 (PRECONDITION). Meta: `filesWritten`, `cause`.

### CLI.INIT_REINIT_NEEDS_FORCE

`prisma orm init` ran non-interactively in a directory that already has a `prisma.config.ts`, and consent to overwrite the existing scaffold was not given. Re-scaffolding is destructive, so it needs explicit consent: interactively, `init` asks the user to type the working directory's name back; non-interactively, the same consent is granted by `--confirm <directory name>`. Neither `--yes` nor any flag skips it. Maps to init exit code 2 (PRECONDITION). Meta: none.

The code was raised by the commander `init` (deleted in the S5 cutover), whose consent flag was `--force`. The engine-hosted `init` reaches the same outcome through the engine's own `CLI.CONSENT_REQUIRED`, which names the exact `--confirm` value to pass.

### CLI.INIT_SKILL_INSTALL_FAILED

Retired. `prisma orm init` used to fetch the agent skills from GitHub with `skills add`, and raised this at exit `6` when that fetch failed. The skills now ship inside the `@prisma/orm-*` packages a project installs, and init copies them into the agent directories by running `prisma skills sync` once, then writes a `postinstall` script that repeats the sync on every later install.

A sync that fails no longer fails anything: init warns and names the command to re-run, the postinstall retries on the next install, and every `prisma` command reports skills that no longer match the installed packages. Init exits `4` or `5` now — there is no exit `6`, and nothing raises this code.

### CLI.INIT_STRICT_PROBE_WITHOUT_PROBE

`prisma orm init --strict-probe` was supplied without `--probe-db`. Init is offline-by-default, so no probe runs without `--probe-db`; rather than silently ignoring the strict flag, init errors and tells the user to add `--probe-db` or drop `--strict-probe`. Maps to init exit code 2 (PRECONDITION). Meta: none.

### CLI.INIT_USER_ABORTED

The user cancelled an interactive `prisma orm init` prompt (Ctrl-C, escape, or declining a selection) before all required inputs were supplied. No files were modified. Severity is `info`, not `error`; maps to init exit code 3 (USER_ABORTED). Meta: none.

Raised by the commander `init` (deleted in the S5 cutover). On the engine-hosted `init` a cancelled prompt is the engine's own `CLI.PROMPT_CANCELLED`, which exits 3 for every command rather than only this one; the engine-hosted `init` keeps this code for a consent the user declines, which settles as an errored envelope at exit 2 like every other structured failure there. Because that command's consent declares a token, the engine answers a wrong or absent answer with `CLI.PROMPT_INVALID` or `CLI.CONSENT_REQUIRED` before a decline can be expressed, so the code is the refusal that runs if a future consent drops its token.

### CLI.INIT_WRITE_FAILED

`prisma orm init` could not write one of the files it scaffolds — a directory sitting where the file goes, permissions, a full disk. Everything that can be read and parsed is checked before the first write, so this is the failure that survives that check; the files written before it are already on disk and are listed so a follow-up run or agent knows the state it is resuming from. Maps to init exit code 2 (PRECONDITION). Meta: `path`, `cause`, `filesWritten`.

### CLI.INVALID_OUTPUT_FORMAT

The main CLI received a `--format` value other than `pretty` or `json`. Raised during global-flag resolution, before any command logic runs. Meta: `value`, `allowed`.

### CLI.INVALID_VERIFY_MODE

`prisma db verify` was given a contradictory mode combination: `--marker-only` together with `--schema-only`, or `--strict` together with `--marker-only` (strict requires schema verification, which marker-only skips). Meta: none.

### CLI.JSON_FORMAT_UNSUPPORTED

Reserved: a command was asked for a `--json` sub-format it does not support; the error lists the formats the command does accept. Declared in the shared error factories but not raised by any command today. Meta: `command`, `format`, `supportedFormats`.

### CLI.OUTPUT_FORMAT_CONFLICT

The main CLI received mutually exclusive output flags: `--format pretty` together with `--json`. Use `--format json` or `--json` alone for JSON output. Meta: none.

### CLI.PROJECT_MANIFEST_INVALID

A `package.json` found while resolving the project import root is not valid JSON, or parses to something other than a JSON object. Emission reads the nearest manifest to decide which package names generated files should import; fix the manifest's JSON and re-run. The parse failure (when there is one) is attached as `cause`. Meta: `path`.

### CLI.PROJECT_MANIFEST_UNREADABLE

A `package.json` found while resolving the project import root exists but could not be read (e.g. a permissions failure). Absent manifests continue the walk up; a read failure stops it, because silently skipping would emit against the wrong project's dependencies. The read failure is attached as `cause`. Meta: `path`.

### CLI.PROMPT_REQUIRED

Raised by `@prisma/cli-engine`, not by this repository: a command asked a question that has no default, and the session could not show it — stdin is not a terminal, `--no-interactive` was passed, or `--yes` was asked to answer a prompt that declares no default. The `CLI` namespace is shared with the engine (see [ADR 239](../architecture%20docs/adrs/ADR%20239%20-%20Errors%20are%20structural%20envelopes%20with%20dotted%20namespace%20codes.md)); it is listed here because it settles runs of the ORM's commands. `prisma orm init` translates it for the two prompts that stand in for a required flag, so a missing `--target` or `--authoring` still reports `CLI.INIT_MISSING_FLAGS` with the full missing list. Meta: none.

### CLI.UNEXPECTED

Catch-all for an unanticipated failure inside a CLI command — an unclassified exception is wrapped in this envelope with the original message as the `why`. Thrown across nearly every command (migrate, db init/sign/update/verify, migration plan/new/show/status/log, contract emit, ref, inspect-live-schema, config loading). Meta: none.

### CLI.UNKNOWN_FLAG

The migration-file CLI (`prisma migration`) received a flag it does not recognise; wraps clipanion's unknown-syntax error at the parser boundary so consumers can build "did you mean" suggestions from meta instead of parsing the message. Meta: `flag`, `knownFlags`.

## CONTRACT

### CONTRACT.ARGUMENT_INVALID

A builder or helper on the contract-authoring surface is called with a bad argument: a composed authoring helper receives too many arguments or a malformed trailing options object, `field.sql({ id })` / `field.sql({ unique })` is used without a matching inline `.id(...)` / `.unique(...)` declaration, `model("Name", ...)` is called without a model definition, a nanoid ID generator is given a size outside 2–255, or an authored index combines its cross-field parameters invalidly (fields and an expression together or neither, an expression without `name:`/`map:`, or `map:` combined with `name:`). Also raised when a contract targets SQLite and declares an expression or partial index — SQLite's namespace construction rejects `expression:`/`where:` because the target does not support them. Raised while authoring/building the contract, before emit. Meta: varies per site.

### CONTRACT.AGGREGATE_DESCRIPTOR_AMBIGUOUS

The SQL emitter cannot name one result type for an aggregate: two trait-matching aggregate descriptors both claim a contributed codec, or a descriptor whose result reuses its input's codec also answers calls that carry no input. Raised while generating `contract.d.ts`, so the emitted types can never disagree with what the runtime registry resolves. Meta: `operation`; plus `codecId` and `traits` when two traits claim one codec, the contested codec being nameable only in that case.

### CONTRACT.AGGREGATE_DESCRIPTOR_DUPLICATE

Two composed components contribute an aggregate descriptor for the same `(operation, input)` overload — keyed as `sum:trait:numeric`, `sum:codec:pg/int8@1`, or `count:none`. Each overload resolves to exactly one result codec, so exactly one target, adapter, or extension may claim it. Raised while the control stack collects contributions (e.g. during `contract emit`); the runtime plane enforces the same rule as `RUNTIME.DUPLICATE_AGGREGATE_DESCRIPTOR`. Meta: `key`, `contributedBy`, `owner`.

### CONTRACT.AGGREGATE_DESCRIPTOR_INVALID

A composed component contributes an aggregate descriptor whose shape the framework cannot read: a missing or empty `operation`, an `input` match that is not `none` / `any` / `codec` / `trait`, an `output` that is not `self` / `codec`, a non-boolean `nullable`, a `nullable: false` descriptor with no `emptyResultJson` (a non-nullable result must declare the value it answers with over no result row), or a `self` output on a match that may carry no input to reuse. Raised while the control stack collects contributions (e.g. during `contract emit`); the runtime plane enforces the same rule as `RUNTIME.AGGREGATE_DESCRIPTOR_INVALID`. Meta: `contributedBy`, `descriptor`.

### CONTRACT.AGGREGATE_OUTPUT_CODEC_MISSING

The SQL emitter is asked to emit an aggregate result row whose declared result codec the composed stack does not contribute — the emitted type would name a codec absent from the contract's codec map, and every consumer reading it would resolve `never`. Contribute the codec, or declare a result codec the stack contributes. Raised while generating `contract.d.ts`. Meta: `operation`, `outputCodecId`.

### CONTRACT.CODEC_DESCRIPTOR_MISSING

The control plane resolves a codec referenced by the contract (a `CodecRef.codecId`) against the contract's pack stack and finds no registered codec descriptor for that id. Hit during control-plane operations (emit, migration tooling) when a contract references a codec no composed pack provides. Meta: `codecId`.

### CONTRACT.CHECK_NAME_RESERVED

An authored `@@check` / `check()`'s `name:` prefix matches the shape a derived enforcement check would use for a column of the same table (`<table>_<column>_check` or `<table>_<column>_elem_not_null`), so it cannot be told apart from a derived check once a non-`managed` table strips those. The message and `collidingColumns` meta name the column(s) whose derived-check shape the prefix matches. Raised while building a SQL contract, once the table's real columns are in hand. The fix is to choose a different `name:`. Meta: `tableName`, `prefix`, `collidingColumns`.

### CONTRACT.CHECK_ON_STI_VARIANT

A model declares `@@check` / `check()` but is a single-table-inheritance variant (`@@base` with no own `@@map`), so it shares its base model's storage table and has no table of its own to declare the check on. Raised while building a SQL contract, as a backstop for the TS authoring path — the PSL surface refuses this earlier, at interpretation, with a span-anchored `PSL_CHECK_ON_STI_VARIANT` diagnostic naming the base model. The fix is to declare the check on the base model instead. Meta: `tableName`, `modelName`.

### CONTRACT.CHECK_OPTOUT_INVALID

A `@noCheck` / `.noCheck(...)` declaration is invalid. Either it does not apply to the column — the named kind is not derivable for the column's shape (`membership` on a column with no domain-enum value set, `elementNotNull` on a column that is not a list of scalars), or the bare form waives nothing because the column derives no generated checks — or the declaration is malformed: a kind is named twice, or `noCheck()` is called more than once on one field builder. Raised by both authoring paths (TS `defineContract` and PSL interpretation) on `managed` tables. Meta: `modelName`, `fieldName`, `reason`, and `kind` for per-kind failures.

### CONTRACT.COLLECTION_INVALID

A Mongo model's collection attachment is wrong: the model declares `indexes`, `collectionOptions`, or `controlPolicy` but has no collection, or a single collection has `collectionOptions` / `controlPolicy` declared by more than one model. Raised by the Mongo `defineContract` builder. Meta: `modelName`, `collection`, `reason`.

### CONTRACT.CONSTRAINT_INVALID

A model declares an empty unique constraint (a unique with no fields), raised during SQL contract lowering (meta: `modelName`). Also raised when a CHECK constraint reaches SQLite migration DDL rendering — the SQLite target does not support CHECK constraints, and `sql.checkConstraint` is a Postgres-only capability. A `@@check` is refused earlier, by the PSL capability gate; a `check()` declared through the TypeScript builder is not, because capabilities reach the contract only after it is built, so this is where a SQLite `check()` is refused (meta: `constraintName`, and `tableName` where available).

### CONTRACT.DEFAULT_INVALID

A field's default declaration is invalid: `defaultSql` is used on an enum field, a field declares both `default` and `executionDefaults`, or a field is nullable while carrying `executionDefaults`. Raised while authoring/building a SQL contract. Meta: `modelName`, `fieldName`, `reason`. Also raised by the Postgres adapter's DDL renderer when a hand-authored `col(...)` pairs an `autoincrement()` default with a type that isn't `SERIAL`/`BIGSERIAL`/`SMALLSERIAL` (or their `SERIAL4`/`SERIAL8`/`SERIAL2` aliases). Meta in that case: `nativeType`.

### CONTRACT.ENTITY_KIND_INVALID

An entity attached to the contract declares a framework-wire namespace entry kind (`table` or `valueSet`), which only the framework itself may mint. Raised while building a SQL contract with pack-contributed entities. Meta: `entityKind`, `namespaceId`.

### CONTRACT.ENTITY_KIND_UNKNOWN

An entity handle passed to the contract has an `entityKind` that no composed pack registers, so the builder cannot lower it — or contract entries carry a kind no composed pack recognizes when the framework hydrates entities from an emitted contract. Raised during SQL contract lowering and entity hydration. Meta: `entityKind`.

### CONTRACT.ENUM_CODEC_NOT_IN_PACK_STACK

An enum declares a `codecId` that no family, target, or extension pack in the contract provides, so its member values cannot be encoded. Raised by both authoring paths (TS `defineContract` and PSL interpretation) when the codec lookup built from the contract's packs has no descriptor for the id. Meta: `codecId`.

### CONTRACT.ENUM_INVALID

An enum declaration is malformed: it has no members, a duplicate member name or value, or the declaration key in `defineContract({ enums })` does not match the `enumType` name. Raised while authoring a contract (framework `enumType`, SQL and Mongo builders). Meta: `enumName`, `member`, `reason`.

### CONTRACT.ENUM_UNKNOWN

A Mongo field references an enum that is not declared in `defineContract({ enums })`. Raised by the Mongo contract builder. Meta: `modelName`, `fieldName`, `enumName`.

### CONTRACT.EXPORT_INVALID

The TS contract module's export is not a plain JSON-serializable contract object: a non-object export, circular references, getters, or function-valued properties. Raised by the CLI while loading a TypeScript contract source. Meta: `path`, `reason`, `key`.

### CONTRACT.FIELD_UNKNOWN

An index or column mapping references a field the model does not declare (unknown field in the contract definition, or a Mongo model index over an undeclared field). Raised while lowering/building the contract. Meta: `modelName`, `fieldName`, `indexSignature`.

### CONTRACT.FOREIGN_KEY_INVALID

A foreign key's target refs are empty or inconsistent: no target ref given, refs point at different models, or compound refs disagree on `spaceId`, `namespaceId`, or `tableName`. Raised by the SQL contract DSL while declaring the FK. Meta: `mismatch`, `first`, `second`.

### CONTRACT.IDENTITY_INVALID

A model's identity is wrong: multiple fields marked `.id()`, identity declared both inline and in `.attributes(...)`, an empty identity, a model with non-owning relations but no id to anchor them, or an M:N target with no primary/unique key to derive junction columns from. Raised while lowering/building a SQL contract. Meta: `modelName`, `reason`.

### CONTRACT.IDENTIFIER_INVALID

A SQL identifier or literal fails escaping-safety checks while rendering DDL/SQL: an empty identifier, a null byte in an identifier or string literal, or a native enum label exceeding PostgreSQL's 63-byte limit. Raised by the Postgres and SQLite SQL utilities (formerly the `SqlEscapeError` class, removed at 0.17). Meta: `value`, `context`.

### CONTRACT.INDEX_INVALID

A Mongo variant model declares an index that conflicts with the discriminator scope of its variant, or a SQL index option value is not a string, finite number, or boolean. Raised by the Mongo contract builder and the Postgres index DDL renderer. Meta: `variantName`, `indexLabel`, `reason`, `key`.

### CONTRACT.INFER_UNSUPPORTED

`contract infer` is not available: either the configured family does not implement the `PslContractInferCapable` capability (no meta at that site), or the family supports inference but the database shape cannot be expressed yet — duplicate table names across schemas, a column typed by a native enum that an extension pack space already describes in another schema, or native enum adoption with content spanning multiple schemas. Meta at the shape sites: `tableName`, `columnName`, `schemas`.

### CONTRACT.INTROSPECTION_UNSUPPORTED

Introspection read an unrecognized or malformed database shape — an unknown referential action rule, or a malformed index reloption entry. Raised by the Postgres and SQLite control adapters. Meta: `rule`, `entry`, `indexName`.

### CONTRACT.MARKER_MISMATCH

The contract hash does not match the marker (signature) stored in the database. `db verify` reports it as an `error` diagnostic on a completed run that exits `4`; the SQL runtime reports it as a warning during startup marker verification. Fix path: migrate the database or re-sign if the divergence is intentional. Meta: `expected`, `actual`.

### CONTRACT.MARKER_MISSING

No contract marker (database signature) is found in the database at all. `db verify` reports it as an `error` diagnostic on a completed run that exits `4`; the runtime reports it as a warning during startup marker verification. Fix path: `prisma db sign`. Meta: none notable.

### CONTRACT.MARKER_READ_FAILED

A driver-level failure occurred while reading the contract marker table — connectivity, permissions, or locking problems rather than bad marker content. Raised whenever a CLI/control operation reads the marker. Meta: `space`.

### CONTRACT.MARKER_REQUIRED

A command that requires a pre-signed database (marker present) as a precondition found none; also the default failure code stamped onto a non-ok verify result when no more specific code applies, which is how `db verify --strict` reports a database holding elements no contract declares. On `db verify` it is an `error` diagnostic on a completed run that exits `4`; everywhere else it is a precondition failure at exit `2`. Those are two unrelated jobs for one code — "sign the database first" and "strict mode found elements no contract declares" — and splitting them would let the exit code follow from the code alone. Fix path: run `prisma db init` first, or declare the extra elements in a contract. Meta: none notable.

### CONTRACT.MARKER_ROW_CORRUPT

The marker row exists but its column values fail schema validation — the row is corrupt or written by an incompatible version. Fix path: delete the row and re-sign with `prisma db sign`. Meta: `space`.

### CONTRACT.MODEL_TOKEN_INVALID

A model token is misused in the TS authoring DSL: an unnamed token is used in `.ref(...)` or as a relation target (tokens need `model("Name", ...)`), or a token is assigned under a `models` key that does not match its name. Meta: `tokenModelName`, `assignedKey`.

### CONTRACT.MODEL_UNKNOWN

A relation, foreign key, junction (`through`) reference, or context declaration names a model that is not declared in the contract. Raised while lowering/building a SQL contract. Meta: `sourceModel`, `relationName`, `targetModel`.

### CONTRACT.MODULE_EXPORT_MISSING

The contract module at the configured path loads but exposes neither a `default` nor a `contract` export, so the CLI cannot obtain the contract from it. Raised when resolving a TS contract from config (SQL and Mongo). Meta: `path`.

### CONTRACT.NAME_DUPLICATE

Two declarations claim the same name: duplicate namespace entries, model names, value objects, relations, tables (two models mapping to one table, or duplicate table in a namespace), column mappings (two fields to one column), indexes, value-sets (enum and pack entity minting the same value-set), or pack entities of the same kind and name in one namespace. Raised while authoring/building a contract. Meta: `kind`, `name`, `namespaceId`, `first`, `second`.

### CONTRACT.NAMESPACE_INVALID

A namespace name is empty, whitespace-only, or a reserved sentinel (`__unbound__`, `__unspecified__`, or Postgres's reserved `unbound`), either in the declared `namespaces` list or on a model. Raised by the SQL contract builder. Meta: `namespace`, `reason`, `modelKey`.

### CONTRACT.NAMESPACE_UNKNOWN

A model references a namespace that is not in the contract's declared `namespaces` list. Raised by the SQL contract builder. Meta: `modelKey`, `namespace`, `declared`.

### CONTRACT.NAMESPACE_UNSUPPORTED

Namespaces are declared (contract-level list or a model-level `namespace`) on a target that has no schema/namespace concept, i.e. SQLite. Raised by the SQL contract builder. Meta: `namespaces`, `modelKey`, `targetId`.

### CONTRACT.NATIVE_TYPE_INVALID

A native type name in the contract fails the identifier-safety pattern required to render it into DDL. Raised by the Postgres and SQLite migration planners while building column DDL. Meta: `nativeType`.

### CONTRACT.PACK_CONTRIBUTION_INVALID

A composed pack's contribution is malformed or collides with another contribution — this is the extension-author-facing bucket. Covers: entity types colliding with reserved helper keys, duplicate entity kinds or index-type registrations, a registered entity kind with no `lowerEntityHandles` lowering, an invalid `indexTypes` shape, entries-slot collisions between a model attribute and a block entry kind, bad authoring-helper paths, a codec registered with an entity-ref arg but no `columnFromEntity` hook, and print-time contribution mismatches (missing/mismatched PSL block descriptor, param descriptor kind disagreeing with the AST node, unregistered codec id, raw literal that is not valid JSON). Raised during contract authoring/lowering and PSL printing. Meta: `packId`, `contribution`, `reason`, `keyword`, `paramName`, `codecId`.

### CONTRACT.PACK_FAMILY_MISMATCH

A pack passed to `defineContract` belongs to the wrong family: a non-SQL pack in a SQL contract (or non-Mongo in a Mongo contract), a target pack whose family disagrees with the contract's, or an extension pack from another family. Meta: `packId`, `packFamilyId`, `contractFamilyId`.

### CONTRACT.PACK_MISSING

A cross-space reference names a contract space that is not declared in the contract's `extensions`, so the space cannot be resolved. Raised during SQL contract lowering. Meta: `spaceId`, `context`.

### CONTRACT.PACK_REF_INVALID

Something other than an extension pack reference was passed in `defineContract`'s `extensions` list (e.g. a family or target pack). Meta: `packId`, `kind`.

### CONTRACT.PACK_TARGET_MISMATCH

An extension pack targets a different database target than the contract does (e.g. a Postgres-only extension pack in a SQLite contract). Raised by the SQL and Mongo contract builders. Meta: `packId`, `packTargetId`, `contractTargetId`.

### CONTRACT.POLICY_INVALID

An RLS policy declaration is invalid: it targets a model in another contract space, its prefix exceeds the length limit or is declared twice in one namespace, or it targets a table that is not RLS-enabled or not present in the namespace. Raised by the Postgres `defineContract` builder and while deriving the Postgres schema tree from the contract. Meta: `prefix`/`policyName`, `tableName`, `namespaceId`, `reason`.

### CONTRACT.RELATION_INVALID

A relation's shape is wrong: `.sql(...)` on a non-belongsTo relation, mismatched field counts between the two sides, an N:M relation without `through` metadata, or a relation target referencing a field of another model. Raised while authoring/building a contract (SQL and Mongo). Meta: `modelName`, `relationName`, `reason`.

### CONTRACT.ROLE_INVALID

A role entity is declared more than once in the entities list, or a role name is not a plain SQL identifier. Raised by the Postgres contract builder and RLS DDL rendering. Meta: `role`, `reason`.

### CONTRACT.SCHEMA_VERIFICATION_FAILED

Schema verification found that the live database schema does not satisfy the contract — missing/extra/mismatched tables, columns, or other elements. `db verify` and `db sign` both report it as an `error` diagnostic on a completed run that exits `4`: for `db verify` that is the drift verdict, and for `db sign` it is the reason no signature was written. `db verify` raises one such diagnostic per contract space whose schema failed. Fix path: `prisma db update` or adjust the contract. Meta: `space` (the contract space, on `db verify`), `issues` (the drifted element paths); the underlying operation result also carries `verificationResult`.

### CONTRACT.SOURCE_IMPORT_DISALLOWED

The TypeScript contract module imports something outside the contract-source import allowlist; contract sources must stay pure so they can be bundled and evaluated deterministically. Raised by the CLI while loading a TS contract source. Meta: `allowlist`, `disallowed`.

### CONTRACT.SOURCE_LOAD_FAILED

Loading the contract source failed: bundling or evaluating the TypeScript contract module (esbuild bundle error, or the module threw on import), the contract source provider returning a failure or a malformed result during `contract emit`, or `format` failing to read the PSL source file. The underlying failure is attached as `cause` where one exists. Meta: `path`, `stage` (`bundle` or `import`) at the TS-loader site; `diagnostics`, `issues`, `providerMeta` at the emit provider site; none at the format read site.

### CONTRACT.TABLE_AMBIGUOUS

A storage table name resolves in more than one namespace of the contract and needs namespace qualification to disambiguate. Raised whenever a bare table name is resolved against contract storage (authoring and runtime paths). Meta: `tableName`, `candidates`.

### CONTRACT.TABLE_MISMATCH

A foreign key or index references a table name that disagrees with the table the target model is actually mapped to. Raised while building a SQL contract. Meta: `sourceModel`, `referencedTable`, `mappedTable`.

### CONTRACT.TARGET_MISMATCH

The contract's target does not match the target configured in `prisma.config.ts` (e.g. a Postgres contract with a SQLite config). `db verify` reports it as an `error` diagnostic on a completed run that exits `4`. Meta: `expected`, `actual`.

### CONTRACT.TYPE_UNKNOWN

A field references a storage type that cannot be resolved: a storage type instance not in `definition.types`, an unknown storage type name, or a field that never resolves to a storage descriptor. Raised during SQL contract lowering. Meta: `modelName`, `fieldName`, `typeRef`.

### CONTRACT.UNREADABLE

The emitted contract file could not be read or parsed while computing `migration status`; reported as a warn-severity diagnostic on the status result rather than a thrown error, with the hint to re-run `prisma contract emit`. Meta: none (diagnostic carries `message` and `hints`).

### CONTRACT.VALIDATION_FAILED

Aggregate contract validation failed: structural validation of the contract JSON (`ContractValidationError` with a `phase` of structural/domain/storage), semantic validation during `buildContract`, or storage/model validators rejecting the built contract. Raised at emit/authoring time and whenever a contract is loaded and validated. Also raised by `migration new` when the emitted contract has no `storageHash`; that site has no meta. Meta: `errors` (aggregate site); the error class also carries `phase`.

### CONTRACT.VERIFY_FAILED

`db verify` failed for a reason the verify result did not classify under a more specific code (marker, target, or schema-verification codes). Reported as an `error` diagnostic on a completed run that exits `4`, with the verify result's own text as the summary. Meta: none.

### CONTRACT.WIRE_NAME_PREFIX_TOO_LONG

An authored wire-name prefix (an index name, an RLS policy prefix, or a check's `name:` prefix) exceeds the 54-byte maximum — Postgres identifiers cap at 63 bytes and the wire name appends a 9-byte `_<8hex>` content-hash suffix. Raised at contract lowering. Meta: `prefix`, `maxBytes`.

## PSL

### PSL.FORMAT_OPTION_INVALID

`resolveFormatOptions` was given an invalid formatting option — a non-positive/non-integer `indent` or an unrecognized `newline` value. Raised before any PSL source is read. Meta: `option`, `received`.

### PSL.PARSE_FAILED

`format()` was asked to format PSL source that has parse errors; formatting refuses to run on an unparseable document. The message carries the first diagnostic and a count of the rest; the CLI `format` command wraps this into a structured failure telling the user to fix the parse errors, attaching the parser error as `cause`. Meta: `diagnostics`.

## ORM

### ORM.AGGREGATE_OPERATION_RESERVED

A contributed aggregate operation carries a name a collection builder member already owns (`select`, `include`, `where`, `combine`, `aggregate`, …, or a collection instance field). Aggregate operations surface as reducer methods on the ORM collection, in one flat namespace with the query-builder members, so a same-named operation would shadow the member it collides with. Raised at ORM composition (`orm(...)`), where the collection surface is assembled. Rename the contributed operation. Meta: `operation`.

### ORM.AGGREGATE_PROJECTION_ONLY

An aggregate operation contributed from outside the closed SQL aggregate alphabet (`count`, `sum`, `avg`, `min`, `max`) was used in HAVING, ORDER BY, or another comparison position. Such an operation reaches SQL only through its descriptor's lowering hook — a rendering meant for the SELECT projection, where the value crosses the driver boundary. HAVING and ORDER BY compare the value inside the database, where that rendering would change SQL semantics (a textual rendering compares and sorts lexicographically), so the query builder refuses at authoring time. Project the aggregate in a select and filter or order on the projected value, or use an operation from the alphabet. Meta: `operation`.

### ORM.AGGREGATE_SELECTOR_INVALID

An `aggregate()` or `groupBy().aggregate()` selector is not a valid aggregation descriptor, or an aggregate function that requires a column/field (e.g. sum, avg) was given none. Thrown when the ORM client builds the aggregate query plan. Meta: `method`, `model`, `alias`, `fn`.

### ORM.AGGREGATE_SELECTOR_MISSING

`aggregate()` or `groupBy().aggregate()` was called with zero aggregation selectors; at least one is required. Meta: `method`, `model` (or `namespaceId`, `tableName`).

### ORM.AGGREGATE_UNSUPPORTED

An aggregate was invoked for an operation/input pair the composed target declares no descriptor for — an undeclared pair has no result identity to type or decode, so it is rejected before any SQL is built rather than executed into a driver-native value. Raised by ORM aggregate planning and decoding, and by the SQL-builder lane's aggregate functions; the typed surfaces already make such a call a type error, so reaching this at runtime means a dynamic or cast invocation. Meta: `operation`, plus `table`/`column`/`inputCodecId` where an input is involved. Contribute an aggregate descriptor for the pair, or aggregate an input the target declares.

### ORM.ARGUMENT_INVALID

A method argument on the ORM client — or on the `sql()` / Mongo query-builder DSLs — is malformed or missing a required part: a `null` where-arg, `upsert()` without conflict columns or without a create value for a conflict column, a custom collection registered as an instance / against a nonexistent model in `orm({ collections })`, invalid builder argument shapes, `$and`/`$or` with no expressions, non-integer limit/skip, or malformed lookup/group/update specs. Meta: `method`, `argument`, `model`, `column`, `key`.

### ORM.CAPABILITY_MISSING

The requested operation requires a contract capability the contract does not declare — currently the `returning` capability needed for mutations that read back the affected row. Raised by the ORM client and the `sql()` builder. Meta: `capability`, `action`.

### ORM.COLUMN_UNKNOWN

A mutation payload or where-expression references a column that does not exist on the resolved table. Thrown while compiling the query plan or binding the where clause — by the ORM client and by the `sql()` builder DSL. Meta: `namespaceId`, `tableName`, `column`.

### ORM.CURSOR_VALUE_MISSING

Cursor pagination was requested but the cursor object lacks a value for one of the `orderBy` columns, so the position cannot be anchored. Meta: `column`.

### ORM.FIELD_IMMUTABLE

A Mongo mutation payload attempts to write `_id`, which is immutable. Thrown by the Mongo ORM client for create/update/upsert payloads. Meta: `field`.

### ORM.FIELD_UNKNOWN

A shorthand relation filter references a field that is not defined on the related model. Thrown by the SQL ORM client while resolving the filter. Meta: `model`, `field`.

### ORM.FILTER_UNSUPPORTED

A shorthand equality filter targets a field whose codec does not support equality comparisons (lacks the equality trait). Meta: `model`, `field`, `trait`.

### ORM.GROUP_BY_FIELD_MISSING

`groupBy()` was called with zero fields; at least one grouping field is required. Meta: `namespaceId`, `tableName`.

### ORM.HAVING_EXPRESSION_UNSUPPORTED

A `groupBy().having()` expression uses a kind the grouped-having compiler does not allow: `ParamRef`/`PreparedParamRef`, list values, non-aggregate expressions, or another unsupported comparable kind. Only aggregate metric expressions are supported. Meta: `kind`.

### ORM.INCLUDE_INVALID

An `include()` usage is structurally invalid: the refinement callback returned something that is not a collection, include-scalar selector, or `combine()` descriptor; a `combine()` branch is invalid or empty; or an include-only action was called outside an `include()` refinement callback. Meta: `relation`, `branch`, `action`.

### ORM.INCLUDE_UNSUPPORTED

The include is well-formed but not supported in this position: scalar aggregations or `combine()` on a to-one relation (SQL), or including an embed relation / compound reference (Mongo — only reference relations can be included). Meta: `relation`, `kind`, `model`.

### ORM.MODEL_UNKNOWN

The Mongo ORM client was asked to operate on a model name that is not in the contract (collection compile, or a raw-pipeline root bound to an unknown model). Meta: `model`, `root`.

### ORM.MUTATION_DATA_MISSING

`create()` or `createAndCount()` was called with zero rows; at least one row of data is required. Meta: `method`, `namespaceId`, `tableName`.

### ORM.MUTATION_ROW_MISSING

A mutation that expected the database to return a row got none — `create()`/`upsert()` read-back, MTI base or variant INSERT, or a nested create. The Prisma-classic analogue of P2025. Meta: `operation`, `model`, `tableName`, `phase`.

### ORM.OPERATION_UNSUPPORTED

A valid ORM method was called in a configuration that does not support it: mutating an MTI variant collection with a method that requires `createAll()`, Mongo `upsert()` with dot-path field operations, or a Mongo mutation carrying windowing (`orderBy`/`skip`/`take`) or includes. Meta: `method`, `model`, `reason`, `field`.

### ORM.RELATION_LINK_DUPLICATE

A `connect()` nested mutation violated a unique constraint on the junction table — the junction link is likely already present. The original driver error is preserved as `cause`. Meta: `relation`, `junction`.

### ORM.RELATION_MUTATION_INVALID

A nested relation mutation's input is malformed: a relation field without a mutator callback or returning an invalid descriptor, `create` without data, `connect`/`disconnect` with a missing or empty criterion, duplicate connect criteria resolving to the same junction link, or conflicting values for a junction column. Meta: `kind`, `relation`, `model`, `problem`, `junction`, `column`.

### ORM.RELATION_MUTATION_UNSUPPORTED

A nested relation mutation kind is not supported in this position: `disconnect()` outside `update()` nested mutations, or connect/disconnect through a junction table with required columns the relation API cannot populate. Meta: `kind`, `relation`.

### ORM.RELATION_ROW_MISSING

A `connect()`/`disconnect()` nested mutation's criterion matched no row on the related model. Meta: `kind`, `relation`.

### ORM.RELATION_UNKNOWN

A referenced relation name does not exist on the model — in `include()` (SQL and Mongo) or when resolving relation metadata from the contract. Meta: `model`, `relation`.

### ORM.ROW_IDENTITY_MISSING

The operation needs a primary key or unique constraint the table does not have: `update()`/`delete()` targeting a single row, or keying the include read-back after a mutation. Meta: `model`, `table`.

### ORM.TABLE_UNKNOWN

The table a collection resolves to does not exist in the contract's storage for the namespace. Thrown during storage resolution or query planning. Meta: `namespaceId`, `tableName`.

### ORM.WHERE_MISSING

A Mongo mutation method (e.g. update/delete variants) requires a prior `.where()` filter and none was set. Meta: `method`.

## RUNTIME

### RUNTIME.ABORTED

An in-flight `query()` or `execute()` operation was cancelled via the per-operation `AbortSignal` passed as the call's `{ signal }` option. `details.phase` says where the abort was observed: `encode`, `decode`, `stream`, or the middleware phases `beforeQuery` / `beforeExecute` / `afterQuery` / `afterExecute` / `onRow`; the envelope's `cause` carries `signal.reason` verbatim. Meta: `phase`.

### RUNTIME.AGGREGATE_DESCRIPTOR_INVALID

A component contributed an aggregate descriptor whose shape the SQL aggregate registry cannot read: a missing or empty `operation`, an `input` that is not `none` / `any` / `codec` / `trait` (including an unknown trait name), an `output` that is not `self` / `codec`, a non-boolean `nullable`, a `nullable: false` descriptor with no `emptyResultJson`, a `self` output on an operation that consumes no input, or a non-callable `lower`. `emptyResultJson` is the value a non-nullable operation answers with when no result row reaches the caller, stated in the result codec's canonical JSON — `0` under `pg/int8number@1`, `'0'` under `pg/int8@1`. Raised while the execution context assembles the registry. Meta: `descriptor`.

### RUNTIME.AGGREGATE_LOWERING_MISSING

An aggregate descriptor declares an operation outside the closed SQL aggregate alphabet (`count`, `sum`, `avg`, `min`, `max`) and carries no `lower` hook. An alphabet operation lowers to a plain aggregate call by default; renderers know no other operation, so any other name must build its expression through a lowering hook from existing AST nodes. Raised while the execution context assembles the aggregate registry. Meta: `operation`, `key`.

### RUNTIME.AGGREGATE_OUTPUT_CODEC_MISSING

An aggregate descriptor names a result codec the composed stack does not register — either its `output` names the codec outright, or a `self` output over an exact input match reuses an input codec the stack never composes. A resolved aggregate decodes its result through the declared codec, so an unregistered one could never decode anything. Raised while the execution context assembles the aggregate registry. Meta: `operation`, `key`, `outputCodecId`.

### RUNTIME.AMBIGUOUS_AGGREGATE_DESCRIPTOR

Two trait-matching aggregate descriptors for one operation both claim a registered codec — the codec advertises both traits, so the result codec is undetermined. Contribute an exact codec descriptor for that operation, or narrow the overlapping trait contributions. Raised while the execution context assembles the aggregate registry, so it never surfaces mid-query. Meta: `operation`, `codecId`, `traits`.

### RUNTIME.ANNOTATION_INAPPLICABLE

A lane terminal (SQL DSL `.build()`, ORM collection terminal) received an annotation whose declared `applicableTo` set does not include the operation kind being built — the runtime check that backs up the type-level annotation validation when it is bypassed via casts or dynamic invocation. Meta: `namespace`, `terminalName`, `kind`, `applicableTo`.

### RUNTIME.AST_INVALID

A lowered SQL AST is structurally invalid: a subquery projecting other than one column, an INSERT with zero rows, a missing column value, an empty onConflict column list or do-update-set, an UPDATE with no SET assignments, an INSERT target table absent from contract storage, or an AST node constructed with invalid arguments (empty FunctionSource column aliases, a CaseExpr with no branches, a raw query declaring a `__proto__` result column — a name that cannot survive as a column, so alias it in SQL and declare the alias). Raised by the Postgres and SQLite SQL renderers and by AST node construction in relational-core. Meta: `node`, `table`, `column`; construction sites carry node-specific fields.

### RUNTIME.AST_UNSUPPORTED

The authored SQL AST uses a feature this target cannot render — e.g. DEFAULT as a value in INSERT … VALUES, WITH ORDINALITY on function sources, or returned-column aliases on function sources, all on SQLite. Raised by the target adapters' renderers. Meta: `node` (INSERT DEFAULT site); `target`, `feature` (function-source sites).

### RUNTIME.BINDING_INVALID

A target facade client (`@internal/postgres`, `@internal/sqlite`, `@internal/mongo`) received a connection binding whose shape is wrong for the target — malformed connection string, unsupported binding kind, or missing required fields. Raised at `connect(...)` / client construction. Meta: `received`, `reason`.

### RUNTIME.BINDING_MISSING

A target facade client was asked to connect with no binding at all (no connection string, no environment fallback). Meta: `expected`.

### RUNTIME.CODEC_DESCRIPTOR_ARRAY_UNSUPPORTED

A codec projection used `CodecRef.many` against a SQLite codec descriptor — SQLite has no stored scalar-array codec protocol, so projecting the whole stored array would be ambiguous. Use a scalar CodecRef or an explicit target representation. Meta: `codecId`.

### RUNTIME.CODEC_DESCRIPTOR_INVALID

A codec descriptor handed to a target codec-descriptor registry (Postgres, SQLite) is not a valid descriptor for that target: wrong discriminant, missing target descriptor methods, or a malformed params schema. Extend the target's descriptor class or adapt a generic descriptor with the target's wrapper (`postgresCodec()` / `sqliteCodec()`). Meta: `codecId`.

### RUNTIME.CODEC_DESCRIPTOR_MISSING

A column (or AST-carried CodecRef) references a `codecId` for which no runtime component registered a codec descriptor — usually the extension pack that owns the codec is missing from the runtime stack. Surfaces at SQL context construction during the contract codec walk, or lazily when the AST codec resolver materializes a codec at query time. Meta: `codecId`; on the column path also `table`, `column`.

### RUNTIME.CODEC_MISSING

Runtime validation of the contract found columns whose `codecId` has no implementation in the codec registry; the error lists every affected column. Surfaces when the codec registry's completeness is validated at context/runtime setup. Meta: `contractTarget`, `invalidCodecs` (list of `{ namespaceId, table, column, codecId }`).

### RUNTIME.CODEC_PARAMETERIZATION_MISMATCH

A column's codec reference disagrees with the codec's parameterization: a parameterized codec is used with no `typeParams` (and its schema requires some), or `typeParams` are supplied to a non-parameterized codec. Surfaces during the SQL context's contract codec walk. Meta: `table`, `column`, `codecId`, `expected`, `actual`.

### RUNTIME.CONTENT_HASH_REQUIRES_RESOLVED_COMMAND

Mongo middleware called `ctx.contentHash(plan)` (or `computeMongoContentHash`) during `beforeExecute`, when `plan.command` is still an unresolved lowered draft rather than a resolved wire command. Compute the hash from `afterExecute`, or use the param mutator instead of reading `plan.command` structurally. Meta: `phase`.

### RUNTIME.CONTRACT_FAMILY_MISMATCH

At SQL context construction, the contract's target family (e.g. `mongo`) does not match the runtime stack's family (`sql`) — the contract was emitted for a different database family than the stack being assembled. Meta: `actual`, `expected`.

### RUNTIME.CONTRACT_TARGET_MISMATCH

At SQL context construction, the contract's target (e.g. `sqlite`) does not match the runtime stack's target descriptor (e.g. `postgres`) — the contract and the adapter/driver stack disagree about the database target. Meta: `actual`, `expected`.

### RUNTIME.DDL_UNSUPPORTED

`lower()` was asked to lower DDL on a surface that cannot do it: the runtime adapter (DDL lowering is a control-plane concern), or the synchronous control lowering path (DDL default literals require async codec encoding — use `lowerToExecuteRequest()`). Raised by the Postgres and SQLite adapters. Meta: `surface`.

### RUNTIME.DECODE_FAILED

A codec's `decode` threw while converting a wire value into its output type during result decoding — surfaces per column (SQL), per document field (Mongo), or per included-relation column (ORM client), with the original error attached as `cause`. Also thrown when a returned row is missing an expected projection alias, or when the JSON array for an include alias fails to parse. Meta: `table`, `column` (or `alias` / `collection` + `path`), `codec`, `wirePreview`.

Codecs also raise this code directly, as a structured envelope with `meta.codecId` and `meta.received`. The integer guards: `pg/int8number@1` and `sqlite/bigintnumber@1` (the `BigIntNumber` type) refuse a stored value outside the safe integer range ±(2^53 − 1) and any non-integral value rather than rounding it; `pg/int8@1`, `pg/unboundedint@1`, and `sqlite/bigint@1` refuse a wire or JSON value that is not a decimal integer. On a flat read the codec's envelope surfaces unchanged; on an `.include()` read the ORM client wraps it in a fresh `RUNTIME.DECODE_FAILED` carrying `table`, `column`, and `codec`, with the codec's envelope on `cause`. One SQLite caveat: on a flat read, `node:sqlite` itself refuses an INTEGER outside the safe range before any codec runs, so for an out-of-band stored value the structured envelope is guaranteed on the include/JSON path, not the flat path.

**Aggregates reach the same guards.** `count()` and `sum()` over integers declare a number-flavoured result codec, so a tally or total past ±(2^53 − 1) raises this code — `pg/int8number@1 value must be an integer within the safe integer range, got 9007199254740992` — instead of returning a rounded value. It fires on the wire path and on the `.include()` path alike: the include projection is a JSON number, but the guard runs after `JSON.parse`, and rounding is monotone, so a value that was outside the range is still outside it. Where the magnitude is real rather than a bug, switch that call to the lossless variant beside it — `countBigInt()`, `sumBigInt()`, or `avgDecimal()`.

### RUNTIME.DUPLICATE_AGGREGATE_DESCRIPTOR

Two components claim the same aggregate overload — the same `(operation, input)` pair, keyed as `sum:trait:numeric`, `sum:codec:pg/int8@1`, or `count:none`. Each overload resolves to exactly one result codec, so exactly one target, adapter, or extension may contribute it. Meta: `key`.

### RUNTIME.DUPLICATE_AUTHORING_DISCRIMINATOR

Two authoring contributions register the same discriminator key — the same `entityType` key or the same `pslBlock` parser keyword — when the framework authoring surface assembles its descriptor registry. Each contribution must use a unique key. Meta: `label`, `key`, `existingPath`, `path`.

### RUNTIME.DUPLICATE_CODEC

Two runtime stack contributors (target pack, extension packs) register a codec with the same id — while the SQL context or Mongo execution stack collects codecs, or while a target codec-descriptor registry (Postgres, SQLite) is composed. Remove the duplicate contribution. Meta: `codecId`; on the Mongo path also `existingOwner`, `incomingOwner`; on the target registry path also `target`.

### RUNTIME.DUPLICATE_MUTATION_DEFAULT_GENERATOR

Two runtime stack contributors register a mutation default generator with the same id while the SQL context collects them. Meta: `id`, `existingOwner`, `incomingOwner`.

### RUNTIME.ENCODE_FAILED

A codec's `encode` threw while converting a user-supplied parameter value to driver wire format during query execution (SQL param encoding, or Mongo param-ref resolution), with the original error attached as `cause`. Meta: `label`, `codec`; SQL path also `paramIndex`.

Codecs also raise this code directly, as a structured envelope with `meta.codecId` and `meta.received`, which surfaces unchanged: writing a value outside ±(2^53 − 1), or a non-integral number, through `pg/int8number@1` or `sqlite/bigintnumber@1` (the `BigIntNumber` type) raises it before any SQL executes.

The integer codecs also check the JS type of the value they are given, and report that separately from the range: `pg/int8number@1` and `sqlite/bigintnumber@1` read a `number`, while `pg/int8@1`, `pg/unboundedint@1`, and `sqlite/bigint@1` read a `bigint`. A value of the other type raises `<codec> value must be a <number|bigint>, got <type> <value>` with `meta.received` naming the type that arrived — the message you get from passing `9n` where a `number` is read, rather than a range complaint about a value plainly inside the range.

The exact integer codecs make one exception, and only on the JSON side. `encodeJson` on `pg/int8@1`, `pg/unboundedint@1`, and `sqlite/bigint@1` also accepts a `number`, because a schema language writes no `bigint` literal — `BigInt @default(0)` arrives as the JSON number `0`. The number must be an integer within the safe range, and a value that is not raises `<codec> number literal must be an integer within the safe integer range, got <value>`: past that range the literal was already rounded before the codec saw it, so its digits no longer name the value that was written. `encode` — the wire path a query parameter travels — takes no such number; it requires the `bigint`.

### RUNTIME.EXECUTION_RESULT_MISSING

A statistics execution completed without returning statement statistics. This indicates a runtime or middleware implementation violated the execution contract instead of returning `{ affectedRows }`. Meta: none.

### RUNTIME.ITERATOR_CONSUMED

An `AsyncIterableResult` (the return value of `query()`) was iterated a second time — each result can be consumed only once, whether via a `for await` loop or via `toArray()`/`await`. Store the array from `toArray()` if you need to reuse the rows. Meta: `consumedBy`, `suggestion`.

### RUNTIME.JSON_SCHEMA_VALIDATION_FAILED

The `arktype-json` codec rejected a JSON value that does not satisfy the column's arktype schema, on encode (writing) or decode (reading). Also thrown when the schema itself cannot be rehydrated from the contract's stored JSON IR. Meta: `codecId`, `issues` (validation) or `jsonIr` (rehydration).

### RUNTIME.MIDDLEWARE_FAMILY_MISMATCH

A middleware registered on the runtime declares a `familyId` (e.g. `sql`) that differs from the runtime's family — e.g. a SQL-only middleware added to a Mongo runtime. Checked when the runtime validates its middleware list. Meta: `middleware`, `middlewareFamilyId`, `runtimeFamilyId`.

### RUNTIME.MIDDLEWARE_INCOMPATIBLE

A middleware declares a `targetId` without also declaring a `familyId` — an invalid combination, since target scoping only makes sense within a family. Checked when the runtime validates its middleware list. Meta: `middleware`, `targetId`.

### RUNTIME.MIDDLEWARE_RESULT_MISMATCH

Middleware returned a query result for a statistics operation, or statistics for a row query. Middleware interception results must carry the same `operation` discriminant as the operation they intercept. Meta: `expected`, `received`.

### RUNTIME.MIDDLEWARE_TARGET_MISMATCH

A middleware declares a `targetId` (e.g. `postgres`) that differs from the runtime's configured target. Checked when the runtime validates its middleware list. Meta: `middleware`, `middlewareTargetId`, `runtimeTargetId`.

### RUNTIME.MISSING_EXTENSION_PACK

At SQL context construction, the contract requires one or more extension packs that no component in the runtime stack provides. Add the missing pack(s) to the stack. Meta: `packIds`.

### RUNTIME.MONGO_STATISTICS_RESULT_INVALID

A Mongo update or delete command did not return exactly one result object with the required numeric native count field. Updates require `modifiedCount`; deletes require `deletedCount`. Meta: `commandKind`, `countField`.

### RUNTIME.MONGO_STATISTICS_UNSUPPORTED

Statistics execution was requested for a Mongo command that does not expose affected-row statistics. Only update and delete command kinds provide the native counts used by this operation. Meta: `commandKind`.

### RUNTIME.MUTATION_DEFAULT_GENERATOR_MISSING

The contract declares column defaults produced by a mutation default generator (e.g. a nanoid/uuid generator) that no runtime component provides — detected up front when the SQL context validates generator coverage, or at mutation time when a generator-kind default spec is resolved. Meta: `ids` (validation pass) or `id` (resolution).

### RUNTIME.NAMESPACE_UNKNOWN

At query-render time a table references a namespace that is not present, or not materialised as a database schema, on the contract. Raised by the Postgres and SQLite SQL renderers. Meta: `table`, `namespaceId`, `reason`.

### RUNTIME.NO_ROWS

`firstOrThrow()` was called on a query result that returned no rows. Use `first()` if an empty result is acceptable.

### RUNTIME.PARAM_REF_CODEC_REQUIRED

While building a query expression, a plain JS value was passed where no codec could be derived — `toExpr` cannot construct a ParamRef for a bare value without an explicit `CodecRef`. Provide a codec at the call site or use a column-bound builder path.

### RUNTIME.PARAM_REF_MISSING_CODEC

The Postgres SQL renderer reached lowering with a ParamRef that carries no bound `CodecRef` — an internal invariant of the AST-bound codec contract, usually indicating a builder path that constructed a ParamRef without threading the column codec. Meta: `paramIndex`, `name`.

### RUNTIME.PREPARE_BIND_ON_ADHOC

An AST containing a prepared-statement bind-site reference (`PreparedParamRef`) was submitted to the ad-hoc `execute()` path. Bind-site references are only valid inside `runtime.prepare(...)`. Meta: `name`.

### RUNTIME.PREPARE_MISSING_PARAM

Executing a prepared statement without supplying a value for one of its declared parameters — the lookup fails rather than silently binding `undefined`. Meta: `name`.

### RUNTIME.PREPARE_UNUSED_PARAM

`runtime.prepare(declaration, callback)` found declared parameter names that the callback's plan never references. Remove the unused declarations or reference them in the plan. Meta: `unused`.

### RUNTIME.RAW_ROW_COLUMN_MISSING

A whole-query raw statement returned a result that omits a column its row spec declares. The runtime never parses the SQL, so the spec is its only description of the result — a column the spec names and the statement does not return is a mismatch the caller has to resolve, by correcting the spec or the statement. Distinct from `RUNTIME.DECODE_FAILED`, which means a codec rejected a value the runtime did expect. Surplus result columns the spec does not declare are dropped silently and never raise this. See [ADR 247](../architecture%20docs/adrs/ADR%20247%20-%20Whole-query%20raw%20SQL%20is%20the%20fragment%20mechanism%20at%20statement%20position.md). Meta: `column`, `declaredColumns`, `resultColumns`.

### RUNTIME.RAW_SQL_UNSUPPORTED_INTERPOLATION

A raw-SQL tagged template interpolated a JS value whose type cannot be auto-inferred to a codec (anything other than number, bigint, string, boolean, or Uint8Array). Wrap the value in `param(...)` with an explicit codec.

### RUNTIME.TRANSACTION_CLOSED

A query result created inside a transaction was read after the transaction ended. Await the result or call `.toArray()` inside the transaction callback.

### RUNTIME.TRANSACTION_COMMIT_FAILED

Committing a transaction failed; the runtime attempts a cleanup rollback and destroys the connection if that also fails. The driver's commit error is attached as `cause`. Meta: `commitError`.

### RUNTIME.TRANSACTION_ROLLBACK_FAILED

Rolling back a transaction after the callback threw itself failed; the connection is destroyed rather than returned to the pool. The original callback error is attached as `cause`. Meta: `rollbackError`.

### RUNTIME.TYPE_PARAMS_INVALID

A parameterized codec's `paramsSchema` rejected the `typeParams` carried by a codec reference (or the schema returned a Promise — runtime validation requires a synchronous Standard Schema validator). The `arktype-json` codec also throws it when the contract's serialized schema expression does not match the rehydrated schema, indicating a stale or hand-edited contract. Meta: `codecId`, `typeParams` (plus `table`/`column` or `typeName` on the contract-walk path).

## DRIVER

### DRIVER.ALREADY_CONNECTED

Calling `connect(binding)` on a driver — or `connect()` on a target facade client (Postgres, SQLite, Mongo) or the CLI control client — that is already connected. Close with `close()` before reconnecting with a new binding. Meta: `bindingKind`.

### DRIVER.CONNECTION_FAILED

A control-plane driver could not establish a database connection (`driver.create(url)` in the SQLite, Postgres, and Mongo control drivers). The `why` carries the underlying driver message and the original error is attached as `cause`; connection URLs in meta are redacted. Meta: `path` (SQLite); `sqlState` plus redacted URL fields (Postgres); redacted URL fields (Mongo).

### DRIVER.NOT_CONNECTED

Using a driver, a target facade client, or the CLI control client before `connect(...)` has been called (or after it was closed) — surfaces from runtime `query` / `execute`, a prepared statement's `query(target, params, options?)`, `acquireConnection`, or `explain`, including lazily when iterating a query result.

### DRIVER.PREPARE_FAILED

A prepared statement failed again after the PostgreSQL driver discarded a stale handle and retried with a fresh handle. The normalized PostgreSQL error is attached as `cause`. Meta: `handle`.

## MIGRATION

### MIGRATION.AMBIGUOUS_MIGRATION_REF

A migration reference (directory name or hash prefix) passed to a CLI command matches migrations in more than one contract space, so the command cannot tell which one you mean. Re-run with `--space <id>` to pick a space. Meta: `ref`, `spaceIds`.

### MIGRATION.AMBIGUOUS_TARGET

The on-disk migration history has diverged into multiple branch tips (typically two developers planned migrations from the same starting point), so commands that auto-resolve a target cannot choose one. Fix by targeting a branch with `ref set`, deleting one of the conflicting migration directories, or passing `--from <hash>`. Meta: `branchTips`, and when divergence context is known `divergencePoint`, `branches`.

### MIGRATION.BUNDLE_NOT_FOUND_FOR_GRAPH_NODE

A hash resolves to a node in the migration graph, but no on-disk migration package has that hash as its destination (`to`), so there is no bundle to read for it. Hit when resolving a ref or hash to a migration bundle (e.g. `migration show`, contract-at resolution). Meta: `hash`, `explicitLabel` (when the user supplied a named reference).

### MIGRATION.CHECK_CONTRACT_UNREADABLE

A `migration check` finding, carried as an `error` diagnostic on a completed run that exits `4`: the `contract.json` for a contract space cannot be read or validated. Re-emit the extension contract artifacts or fix the descriptor producing the invalid contract.

### MIGRATION.CHECK_DANGLING_REF

A `migration check` finding, carried as an `error` diagnostic on a completed run that exits `4`: a ref file points at a contract hash that does not exist in the space's migration graph. Update the ref with `prisma ref set <name> <valid-hash>` or delete it.

### MIGRATION.CHECK_DECLARED_BUT_UNMIGRATED

A `migration check` finding, carried as an `error` diagnostic on a completed run that exits `4`: an extension is declared in `extensions` but has no on-disk migrations directory under `migrations/`. Re-emit the extension's contract-space artifacts, or remove the extension from `extensions`.

### MIGRATION.CHECK_DUPLICATE_MIGRATION_HASH

A `migration check` finding, carried as an `error` diagnostic on a completed run that exits `4`: multiple migration packages in the same contract space share the same `migrationHash`, so the packages are not uniquely content-addressed. Re-emit one of the conflicting packages.

### MIGRATION.CHECK_FILE_MISSING

A `migration check` finding, carried as an `error` diagnostic on a completed run that exits `4`: a required file (`migration.json` or `ops.json`) is missing from a migration package directory. Re-emit the package or restore it from version control.

### MIGRATION.CHECK_HASH_MISMATCH

A `migration check` finding, carried as an `error` diagnostic on a completed run that exits `4`: the `migrationHash` stored in `migration.json` does not match the hash recomputed from the package contents — the package was edited or partially written since emit. Re-emit the package or restore it from version control.

### MIGRATION.CHECK_HEAD_REF_MISSING

A `migration check` finding, carried as an `error` diagnostic on a completed run that exits `4`: a contract space has no `refs/head.json`. Re-emit the contract-space migrations and head-ref artifacts, or restore the file from version control.

### MIGRATION.CHECK_HEAD_REF_NOT_IN_GRAPH

A `migration check` finding, carried as an `error` diagnostic on a completed run that exits `4`: the hash in a space's `refs/head.json` is not a node in that space's migration graph. Re-emit the space's migrations or restore the missing migration package.

### MIGRATION.CHECK_NOOP_SELF_EDGE

A `migration check` finding, carried as an `error` diagnostic on a completed run that exits `4`: a migration has identical source and target hashes and declares no data invariant — a true no-op self-edge. Add a data operation if it was meant to carry one, or delete the migration.

### MIGRATION.CHECK_ORPHAN_SPACE_DIR

A `migration check` finding, carried as an `error` diagnostic on a completed run that exits `4`: a contract-space directory exists under `migrations/` but no declared extension claims it. Remove the directory or declare the extension in `extensions`.

### MIGRATION.CHECK_PACKAGE_UNLOADABLE

A `migration check` finding, carried as an `error` diagnostic on a completed run that exits `4`: a migration package directory exists but could not be loaded (parse or validation failure); the row's detail names the underlying cause. Re-emit the package or restore it from version control.

### MIGRATION.CHECK_PROVIDED_INVARIANTS_MISMATCH

A `migration check` finding, carried as an `error` diagnostic on a completed run that exits `4`: the `providedInvariants` list stored in `migration.json` disagrees with the one derived from `ops.json`. Re-emit the package so the two files agree.

### MIGRATION.CHECK_REF_UNREADABLE

A `migration check` finding, carried as an `error` diagnostic on a completed run that exits `4`: a ref file in a space's `refs/` directory cannot be read or parsed. Repair or remove the corrupt ref file.

### MIGRATION.CHECK_SNAPSHOT_HASH_MISMATCH

A `migration check` finding, carried as an `error` diagnostic on a completed run that exits `4`: a migration declares a destination hash `to` but the contract snapshot stored for that hash has a different inner `storage.storageHash`. Re-emit the package so `migration.json` and its snapshot agree.

### MIGRATION.CHECK_SNAPSHOT_UNPARSEABLE

A `migration check` finding, carried as an `error` diagnostic on a completed run that exits `4`: either the migration's `to` value is not a well-formed 64-hex hash, or the contract snapshot stored for it exists but cannot be parsed. Re-emit the package, or restore `migrations/snapshots/` from version control.

### MIGRATION.CHECK_SPACE_DISJOINTNESS_VIOLATION

A `migration check` finding, carried as an `error` diagnostic on a completed run that exits `4`: a storage element (table/collection) is claimed by more than one contract space. Update the contracts so each storage element is owned by exactly one space.

### MIGRATION.CHECK_TARGET_MISMATCH

A `migration check` finding, carried as an `error` diagnostic on a completed run that exits `4`: a contract space's declared database target differs from the project's configured target. Update the extension to target the configured database, or change the project target.

### MIGRATION.CHECK_UNREACHABLE_MIGRATION

A `migration check` finding, carried as an `error` diagnostic on a completed run that exits `4`: a migration's `from` hash is not produced by any other migration (and is not the empty state), so the migration is unreachable in the graph. Delete it or re-emit a connecting migration.

### MIGRATION.CONSENT_PLAN_MISMATCH

An apply carrying consent was refused because the plan recomputed for it is not the plan that was consented to. `db update` recomputes the plan at apply time and compares its hash against the one the consent was given for; a mismatch means the schema, the contract, or the database moved in between, so applying would carry out operations nobody agreed to. Re-run the command and review the freshly planned operations before consenting again. Meta: `consentedPlanHash`, `planHash`.

### MIGRATION.CONTRACT_DESERIALIZATION_FAILED

A contract JSON on disk failed to deserialize into a valid contract: either a snapshot-store entry read while migration tooling resolved a contract at a ref or hash, or the emitted `contract.json` read as the fallback source by `db sign` / `db update --to` (invalid JSON, or a value that is not a JSON object). Re-emit the owning migration package (or re-run `prisma contract emit` for the emitted contract), or restore the file from version control. Meta: `filePath`, `message`. Also raised by `migration new` when the emitted `contract.json` fails to deserialize; that site has no meta and attaches the deserialization failure as `cause`.

### MIGRATION.CONTRACT_SNAPSHOT_HASH_MISMATCH

While writing a contract snapshot, the contract JSON's inner `storage.storageHash` does not equal the storage hash the snapshot is being filed under — the two must agree by construction. Primarily an authoring/tooling invariant rather than something a user causes directly. Meta: `storageHash`, `actualHash`, `dir`.

### MIGRATION.CONTRACT_SNAPSHOT_MISSING

A contract snapshot expected under `migrations/snapshots/` for a given storage hash does not exist on disk, so commands that need the contract at that hash (`migration plan`, `ref`-based resolution, `migration check`) cannot proceed. Re-run the command that authored the referencing migration to regenerate the snapshot, or restore `migrations/snapshots/` from version control. Meta: `storageHash`, `expectedPath`.

### MIGRATION.CONTRACT_SPACE_LAYOUT_VIOLATION

The on-disk `migrations/` directory and the `extensions` declaration in config disagree: an orphan space directory exists with no declaring extension, or a declared extension has no migrations directory. All layout offences are bundled into one envelope. Raised when db commands load the contract-space aggregate. Meta: `violations` (list of `{kind, spaceId}`).

### MIGRATION.CONTRACT_SPACE_VIOLATION

A contract-space check raised under one code, in two lanes with different exits. As an error at exit `2` when the check could not run: a space's target mismatches the project target, two spaces claim the same storage element, a space contract is unreadable, or aggregate introspection failed (`db verify`, `db run`). As an `error`-severity diagnostic on a completed `db verify` run that exits `4` — including under `--marker-only` — when the check ran and found per-space marker drift: a marker hash mismatch, missing invariants, or an orphan marker row, reported next to the single-contract marker findings that already settle there. The envelope's `why` lists the specific violations. Meta: `violations`.

### MIGRATION.CONTRACT_VIEW_MISSING

A migration object's `endContract`/`startContract` accessor was read, but the instance carries no `endContractJson`/`startContractJson` to build the contract view from — typically a migration that overrides `describe()` and carries no contract. Meta: `className`, `accessor`, `jsonField`.

### MIGRATION.DATA_TRANSFORM_CONTRACT_MISMATCH

At migration authoring/emit time, a `dataTransform(endContract, …)` produced a query plan whose storage hash does not match the contract passed to `dataTransform` — the query builder was configured with a different contract reference than the migration itself. Make both use the same imported `endContract`. Meta: `dataTransformName`, `expected`, `actual`.

### MIGRATION.DESCRIBE_INVALID

A migration author class's `describe()` result is unusable: it carries neither an `endContractJson` nor an override, or the returned metadata fails validation. Raised while loading/describing an authored migration. Meta: `reason`.

### MIGRATION.DESCRIPTOR_HEAD_HASH_MISMATCH

An extension descriptor publishes a `contractSpace` whose `headRef.hash` does not match the hash recomputed from its `contractJson` — the descriptor was published with a stale head hash, typically because the contract was bumped without rerunning the extension's emit pipeline. Meta: `extensionId`, `recomputedHash`, `headRefHash`.

### MIGRATION.DESTINATION_CONTRACT_MISMATCH

Runner-level failure during apply (`db init`, `db update`, `migrate`): the plan's destination storage hash (or profile hash) does not match the destination contract handed to the runner alongside it. Indicates the plan and contract came from different emits. Meta: `planStorageHash`/`contractStorageHash` (or `planProfileHash`/`contractProfileHash`).

### MIGRATION.DESTRUCTIVE_CHANGES

The planned operations include destructive changes (e.g. DROP) and the command was run without explicit consent. `db update` asks for that consent instead of failing: interactively it asks you to type the name of the database it is about to change, and outside an interactive terminal it is granted by `--confirm <database>` (`--yes` accepts declared prompt defaults and never grants consent; `--confirm` is read only when the run is non-interactive or `--yes` is set, so a script run from a terminal needs `--no-interactive --confirm <database>`). The name is the `database` a driver connection object carries, or the connection URL's first path segment, else its host, falling back to the target id. A run with nobody to ask and no `--confirm` settles as `CLI.CONSENT_REQUIRED` at exit 2; a run whose prompt is cancelled settles as `CLI.PROMPT_CANCELLED` at exit 3. `--dry-run` never asks — it settles as this error instead. Use it to preview the operations first.

### MIGRATION.DIR_EXISTS

`migration new`/`migration plan` refused to scaffold because the target migration directory already exists — each migration needs a unique directory. Pick a different `--name` or delete the existing directory. Meta: `dir`.

### MIGRATION.DUPLICATE_INVARIANT_IN_EDGE

Two `dataTransform` operations on the same migration declare the same `invariantId`. Invariants are stored per-migration as a set, so two operations cannot share a routing identity; rename one, or drop the `invariantId` on the operation that need not be routing-visible. Meta: `invariantId`.

### MIGRATION.DUPLICATE_MIGRATION_HASH

While reconstructing the migration graph, two migrations were found sharing the same `migrationHash`; each migration must have a unique content-addressed identity. Regenerate one of the conflicting migrations. Meta: `migrationHash`.

### MIGRATION.DUPLICATE_SPACE_ID

The per-space migration planner received the same contract-space id more than once, usually a repeated entry in `extensions`. Deduplicate the inputs. Meta: `spaceId`.

### MIGRATION.EXECUTION_FAILED

A migration operation's SQL step failed while being executed against the database during apply (`db init`, `db update`, `migrate`). The envelope carries the database error detail so you can see which statement failed and why. Meta: `operationId`, `stepDescription`, `sql`, `sqlState`, `constraint`, `table`, `column`, `detail`.

### MIGRATION.FILE_MISSING

A required migration file is absent: either an on-disk package is missing `migration.json`/`ops.json` (migration-tools loader — re-emit via the package's `migration.ts`), or a `migration.ts` source file was expected at a package directory and not found (scaffold one with `migration new` or `migration plan`). Meta: `file`, `dir` (loader variant) or `dir` (source-file variant).

### MIGRATION.FOREIGN_KEY_VIOLATION

SQLite only: after applying migration plans with `PRAGMA foreign_keys` temporarily off (needed for recreate-table operations), the post-apply `PRAGMA foreign_key_check` reported broken references, and the whole transaction is rolled back. Meta: `violations` (rows from the pragma).

### MIGRATION.HASH_MISMATCH

A migration package on disk is corrupt: the `migrationHash` stored in `migration.json` does not match the hash recomputed from the package contents. Raised whenever migration tooling loads packages (plan, list, apply). Re-emit the package via its `migration.ts` or restore from version control. Meta: `dir`, `storedHash`, `computedHash`.

### MIGRATION.HASH_NOT_IN_GRAPH

A contract hash the user supplied (or that a ref resolved to) is not a node in the on-disk migration graph — raised during plan resolution (`migration plan --from`), `ref set`, and `migration new --from`. The envelope lists the reachable hashes and suggests a valid one or running `migration plan` to introduce it. Meta: `hash`/`resolvedHash`, `reachableHashes` or `reachableRefs`, sometimes `graphTipHash`; none at the `migration new` site.

### MIGRATION.INVALID_DEFAULT_EXPORT

The `migration.ts` in a package directory does not default-export a valid migration: it must export a `Migration` subclass or a factory function returning a plan-shaped object (`operations` array plus `targetId` and `destination`). Meta: `dir`, `actualExport` (when known).

### MIGRATION.INVALID_DEST_NAME

A copy-destination name in a migration package's copy list is not a single path segment (contains `..` or directory separators). Use a simple file name such as `contract.json`. Meta: `destName`.

### MIGRATION.INVALID_INVARIANT_ID

An `invariantId` on a `dataTransform` is empty or contains whitespace/control characters. Pick an id without spaces, tabs, newlines, or control characters. Meta: `invariantId`.

### MIGRATION.INVALID_JSON

A migration file (`migration.json` or `ops.json`) exists but is not parseable JSON. Re-emit the package via its `migration.ts` or restore from version control. Meta: `filePath`, `parseError`.

### MIGRATION.INVALID_MANIFEST

A `migration.json` manifest parsed as JSON but failed schema validation. Re-emit the package or restore from version control. Meta: `filePath`, `reason`.

### MIGRATION.INVALID_NAME

The migration name given to `migration new`/`migration plan --name` contains no valid characters after sanitization (only a-z and 0-9 are kept). Provide a name with at least one alphanumeric character. Meta: `slug`.

### MIGRATION.INVALID_OPERATION_ENTRY

An operation returned by an authored migration class failed schema validation during emit — each entry of `operations` must carry `id`, `label`, and an `operationClass` of `additive`, `widening`, `destructive`, or `data`. Also raised when deserializing a persisted Mongo migration plan hits a malformed or unknown entry (filter, pipeline stage, DML/DDL/inspection command). Meta: `index`, `reason` (emit validation) or `context`, `kind` (plan deserialization).

### MIGRATION.INVALID_REF_FILE

A ref file under `migrations/<space>/refs/` is not valid JSON or does not match the expected `{ "hash": "<64 hex>", "invariants": [...] }` shape. Meta: `path`, `reason`.

### MIGRATION.INVALID_REF_NAME

A ref name is syntactically invalid: names must be lowercase alphanumeric with hyphens or forward slashes, with no `.` or `..` segments. Raised by `ref` commands and any ref-consuming tooling. Meta: `refName`.

### MIGRATION.INVALID_REF_VALUE

The value given for a ref (e.g. to `ref set`) is not a valid contract hash — it must be 64 lowercase hex chars or `empty`. Meta: `value`.

### MIGRATION.INVALID_REFS

A legacy `refs.json` file is invalid — it must be a flat object mapping valid ref names to contract hash strings. Meta: `path`, `reason`.

### MIGRATION.INVALID_SPACE_ID

A contract-space id (e.g. via `--space` or in planner input) does not match the required pattern `[a-z][a-z0-9_-]{0,63}` — space ids double as directory names under `migrations/`, so the rule is conservative. Meta: `spaceId`.

### MIGRATION.LEGACY_MARKER_SHAPE

The database's marker table (`prisma_contract.marker` on Postgres, `_prisma_marker` on SQLite) has the pre-per-space shape (no `space` column). The transitional auto-migration has been removed; drop the marker table and re-run `prisma db init` to reinitialise from a clean baseline. Detected during `db init`/`db update`/apply. Meta: `table`, `columns` (runner variant) or `runnerErrorCode` (marker-read variant).

### MIGRATION.LEGEND_HUMAN_ONLY

`migration list --legend` was combined with a machine-readable or silent output flag (`--json`, `--dot`, or `--quiet`); the legend is human-only decoration on stderr. Drop one of the flags. Meta: `conflictingFlag`.

### MIGRATION.MARKER_CAS_FAILURE

While finalizing an apply, the compare-and-swap update of the database's contract marker found the marker had been modified by another process mid-migration — a concurrent migration raced this one. Meta: `space`, `expectedStorageHash`, `destinationStorageHash`.

### MIGRATION.MARKER_MISMATCH

The live database marker's contract hash is not reachable anywhere in the on-disk migration graph — the database and the local migration history have diverged. The fix depends on which side is canonical: `migration plan --from <tip>` (catch the graph up), `ref set db <markerHash>` (fix a drifted local ref), or investigate out-of-band migration. Meta: `markerHash`, `reachableHashes`, `graphTip` (when the graph has a tip).

### MIGRATION.MARKER_NOT_IN_HISTORY

A warning diagnostic (not a hard failure) in `migration status`: the database's marker hash does not match any migration in the history, meaning the database was updated outside the migration system. Hints suggest `db sign` (overwrite marker) or `db update` (push the contract).

### MIGRATION.MARKER_ORIGIN_MISMATCH

Runner-level failure during apply: the plan asserts an origin contract, but the database marker is missing, or its storage hash (or profile hash) differs from the plan's origin — the database is not at the state the plan was computed from. Re-plan from the database's actual state; `db init` intercepts this code to render an init-specific "already initialised at a different contract" message. Meta: `expectedOriginStorageHash` plus `markerStorageHash`/`markerProfileHash` depending on the branch.

### MIGRATION.MISSING_INVARIANTS

A diagnostic in `migration status`: the active ref requires data invariants that the database marker does not record as provided. If no path through the graph can supply them, status escalates to `MIGRATION.NO_INVARIANT_PATH`. Meta: `ref` (when a ref is active), `invariants` (the missing ids).

### MIGRATION.NO_CHANGES

`migration new` found the from and to contract hashes identical — there is nothing to migrate. Change the contract and re-run `prisma contract emit` first, or pass `--from <hash>` explicitly to author a data-only migration on the current contract hash. Meta: none.

### MIGRATION.NO_INITIAL_MIGRATION

While reconstructing the migration graph, no migration starts from the empty contract state, so the history has no entry point. Usually indicates corrupted `migration.json` files. Meta: `nodes` (known hashes).

### MIGRATION.NO_INVARIANT_PATH

The target (or named ref) requires data invariants, and no path through the migration graph from the current state covers all of them. Add a migration on the path that runs a `dataTransform` with each missing `invariantId`, or retarget the ref. Meta: `required`, `missing`, `structuralPath` (edges: `dirName`, `migrationHash`, `from`, `to`, `invariants`), `refName` (when applicable). Also raised per space by `migrate` in show/plan mode when a space's path requires invariants not available on disk; that site's meta is `spaceId`, `missing`.

### MIGRATION.NO_MIGRATIONS

`migration show` was given a non-path reference but the app space has no migration packages at all, so there is nothing to resolve against. Create a migration with `prisma migration plan` first. Meta: none.

### MIGRATION.NO_TARGET

The migration history contains cycles (e.g. after a rollback migration C1→C2→C1) and no target can be resolved automatically. Pass `--from <hash>` to specify the planning origin explicitly. Meta: `reachableHashes`.

### MIGRATION.OPERATION_UNSUPPORTED

A Mongo migration check uses a filter feature the check evaluator does not support — an unsupported filter operator, or an aggregation-expression filter. Meta: `operator`.

### MIGRATION.PACKAGE_NOT_FOUND

`migration show` or `migration check` resolved its target (a directory path, or a migration reference) but no loaded on-disk migration package matches it — either no package lives at the given path, or the resolved migration's package failed to load. `migration check` raises it at exit `2`: it could not run the check at all, which is different from running it and finding something. Pass a directory name, hash prefix, or path to an on-disk migration package, or inspect the migrations directory for corruption. Meta: none.

### MIGRATION.PATH_UNREACHABLE

An apply command (`migrate`/`db update`) cannot find a path through the on-disk migration graph from the database's current marker to the requested target — the connecting edge was never planned. The fix walks you through `migration plan` (with the right `--from`/`--to`) then `migrate`. Meta: carries the underlying failure's meta (`fromHash`, `targetHash`, `deadEnds`, `kind`).

### MIGRATION.PLANNING_FAILED

Migration planning (typically during `db init`/`db update`) failed because of conflicts, e.g. the live database already contains objects that clash with the plan. The envelope aggregates each conflict's summary and suggested fix. Meta: `conflicts`.

### MIGRATION.PLAN_NOT_ARRAY

An authored migration's `operations` getter returned something other than an array. Fix the migration class so `operations` returns an array of operations. Meta: `dir`, `actualValue` (when known).

### MIGRATION.POLICY_VIOLATION

A planned operation's class (e.g. `destructive`) is not allowed by the execution-time operation policy in force for the command. Runner-level failure during apply. Meta: `operationId`, `operationClass`, `allowedClasses`.

### MIGRATION.POSTCHECK_FAILED

After executing a migration operation, one of its postcheck steps (a query expected to return true) did not hold, so the apply is rolled back. Meta: `operationId`, `phase`, `stepDescription`.

### MIGRATION.POSTGRES_CONTROL_STACK_MISSING

A `PostgresMigration` operation (e.g. `createTable`, `dataTransform`) was invoked on an instance constructed without a control stack — normal CLI-driven runs always assemble one from `prisma.config.ts`, so this indicates a test fixture or ad-hoc consumer used the no-arg constructor (valid only for introspection). Meta: `operation`.

### MIGRATION.PRECHECK_FAILED

Before executing a migration operation, one of its precheck steps (a query expected to return true) did not hold — the database is not in the state the operation requires — so the apply stops and rolls back. Meta: `operationId`, `phase`, `stepDescription`.

### MIGRATION.PROVIDED_INVARIANTS_MISMATCH

The `providedInvariants` stored in `migration.json` disagrees with the canonical value derived from `ops.json` — the manifest was likely hand-edited without re-emitting (a same-ids-different-order case is called out explicitly). Re-emit the package. Meta: `filePath`, `stored`, `derived`, `difference` (`{missing, extra}`).

### MIGRATION.REF_AMBIGUOUS

A contract or migration reference prefix matches more than one candidate (raised by the shared ref-resolution mapper used across CLI commands). Provide a longer prefix or the full hash. Meta: `input`, `candidates`, `grammar`.

### MIGRATION.REF_INVALID_FORMAT

A contract or migration reference is syntactically invalid — it is not a hash, ref name, or migration directory name in any accepted form (raised by the shared ref-resolution mapper). Meta: `input`.

### MIGRATION.REF_NOT_FOUND

A contract or migration reference does not resolve: no matching hash, ref name, or migration directory name exists in the migration graph or refs index (raised by the shared ref-resolution mapper used across CLI commands). Meta: `input`, `grammar`.

### MIGRATION.REF_NOT_RESOLVABLE

A ref name resolves to nothing: no pointer file with that name exists, and the fallback hash is not a node in the migration graph either, so there is no contract to materialize. Create the ref with `ref set`, advance it via `db update --advance-ref`, or pass a graph-node hash. Meta: `refName`, `identifier`.

### MIGRATION.REF_SET_BUNDLE_NOT_FOUND

`ref set` resolved the given hash to a graph node, but no on-disk migration bundle has that hash as its destination, so the ref would point at a node with no backing package. Re-emit the migration that produces this hash. Meta: `hash`.

### MIGRATION.REF_SET_EMPTY_SENTINEL

`ref set` was asked to point a ref at the empty-database sentinel hash, which is a planner internal and not a valid ref target. Use a real contract hash from the migration graph. Meta: `hash`.

### MIGRATION.REF_WRONG_GRAMMAR

A reference parsed, but as the wrong kind for the argument position — e.g. a migration-only reference where a contract reference is required (raised by the shared ref-resolution mapper). The message and fix come from the resolver's own diagnosis. Meta: `input`, `expectedGrammar`.

### MIGRATION.RUNNER_FAILED

Generic wrapper for a migration runner failure during execution that has no more specific code; the summary/why carry the underlying detail (also used to surface the legacy-marker-shape condition from marker reads, with `meta.runnerErrorCode`). `migrate` and `db init` map unrecognized apply failures through it, passing the failure's own meta through unchanged. Inspect the reported summary/why detail and address the underlying failure before re-running the command. Meta: the wrapped failure's meta, when it has any; `runnerErrorCode` at the legacy-marker-shape site.

### MIGRATION.SAME_SOURCE_AND_TARGET

A migration's `from` and `to` hashes are identical and it declares no data-transform operations — a pure no-op self-edge, which is only allowed when the migration runs at least one `dataTransform`. Change the contract, add a dataTransform, or delete the migration. Meta: `dirName`, `hash`.

### MIGRATION.SCHEMA_VERIFY_FAILED

After applying migrations, the runner introspected the database and the resulting schema does not satisfy the destination contract; the apply is rolled back. Runner-level failure during `db init`/`db update`/`migrate`. Meta: `issues` (schema diff issues).

### MIGRATION.SNAPSHOT_MISSING

A `--from` reference cannot produce a contract: either a ref name has no pointer file and the fallback hash is not a graph node (`viaRef: true`), or an explicit `--from <hash>` was given on an empty migration graph and names no ref (`viaRef: false`). Meta: `identifier`, `viaRef`. Also raised by `db sign` when a contract reference resolves to a hash but no migration produces that hash and the emitted contract does not match; that site has no meta.

### MIGRATION.SPACE_NOT_FOUND

`migration list --space <id>` (and similar space-scoped commands) named a contract space with no directory under `migrations/`. Distinct from an existing-but-empty space, which renders an empty state and exits 0. The envelope lists the space directories that do exist. Meta: `spaceId`, `availableSpaces`.

### MIGRATION.SQLITE_CONTROL_STACK_MISSING

SQLite twin of `MIGRATION.POSTGRES_CONTROL_STACK_MISSING`: a `SqliteMigration` operation needing the control adapter was invoked on an instance constructed without a control stack (only introspection is valid in that form). Meta: `operation`.

### MIGRATION.TARGET_MISMATCH

A migration script declares one `targetId` but the loaded `prisma.config.ts` declares another; the script can only run against a config targeting the same database. Switch configs or pass `--config <path>`. Meta: `migrationTargetId`, `configTargetId`.

### MIGRATION.TARGET_NOT_APP_SPACE

A filesystem-path target given to a migration command does not resolve to an app-space migration directory — it points outside the app space's migrations directory, or at that directory's root itself. Pass an app-space migration directory or use a hash prefix. Meta: none.

### MIGRATION.TARGET_UNSUPPORTED

The configured target does not provide migration support (no planner/runner via `target.migrations`), so migration commands like `db init` cannot run against it. Select a target that provides migrations.

### MIGRATION.UNFILLED_PLACEHOLDER

A scaffolded migration still contains a `placeholder(...)` call that the author never replaced with a real query; it throws when the migration is emitted or run. The `slot` names the exact location to edit (e.g. `"backfill-product-status:check.source"`). Meta: `slot`.

### MIGRATION.UNKNOWN_INVARIANT

A ref declares required invariants that no migration anywhere in the graph provides — either the ref has a typo or the providing migration has not been authored yet. Meta: `unknown`, `declared`, `refName` (when applicable).

### MIGRATION.UNKNOWN_REF

A ref name was used (read, resolved, or deleted via `ref` commands) but no ref file with that name exists. Create it with `prisma ref set <name> <hash>`, or run `ref list` to see what exists. Meta: `refName`, `filePath` or `availableRefs` depending on the site.

## PLAN

### PLAN.HASH_MISMATCH

At execute time, the plan's `meta.storageHash` does not match the runtime contract's storage hash — the plan was built against a different version of the contract than the one the runtime holds. Rebuild the plan against the current contract. Meta: `planStorageHash`, `runtimeStorageHash`.

### PLAN.TARGET_MISMATCH

At execute time, the plan's `meta.target` does not match the runtime contract's target — e.g. a plan built for postgres submitted to a sqlite runtime. Meta: `planTarget`, `runtimeTarget`.

## BUDGET

### BUDGET.ROWS_EXCEEDED

The `budgets` middleware blocks (or warns about) a query expected or observed to return more rows than the configured `maxRows` budget. Thrown before execution for an unbounded SELECT (no LIMIT, no aggregate-without-GROUP-BY) or when the AST-based row estimate exceeds the budget, and during row streaming when the observed row count crosses `maxRows`; raw-SQL guardrails also emit it for raw SELECT text without a LIMIT clause. Meta: `source` (`'ast'` or `'observed'`), `estimatedRows`, `observedRows`, `maxRows`.

### BUDGET.TIME_EXCEEDED

The `budgets` middleware reports after execution that a query's latency exceeded the configured `maxLatencyMs` budget. Default severity is warn (logged); it throws when the latency severity is configured as `error` or the runtime runs in strict mode. Meta: `latencyMs`, `maxLatencyMs`.

## LINT

### LINT.DELETE_WITHOUT_WHERE

The `lints` middleware found a DELETE plan with no WHERE clause and blocks execution to prevent an accidental full-table deletion. Default severity is error (throws); configurable to warn. Meta: `table`.

### LINT.NO_LIMIT

The `lints` middleware (or raw-SQL guardrails) found a SELECT with no LIMIT, which may return an unboundedly large result set. Default severity is warn (logged, execution proceeds); raw-SQL plans are checked heuristically against the SQL text. Meta: `table` (AST path) or `sql` snippet (raw path).

### LINT.READ_ONLY_MUTATION

Raw-SQL guardrails found a mutating statement (INSERT/UPDATE/DELETE/DDL) in a plan whose meta annotations declare a read-only intent (`read`, `report`, or `readonly`). Default severity is error (throws). Meta: `sql`, `intent`.

### LINT.SELECT_STAR

The `lints` middleware found a query that selects all columns — via the builder's selectAll intent on AST plans, or a literal `SELECT *` in raw SQL. Default severity is warn on the AST path, error on the raw path. Meta: `table` (AST path) or `sql` snippet (raw path).

### LINT.UPDATE_WITHOUT_WHERE

The `lints` middleware found an UPDATE plan with no WHERE clause and blocks execution to prevent an accidental full-table update. Default severity is error (throws); configurable to warn. Meta: `table`.

## PARADEDB

### PARADEDB.ARGUMENT_INVALID

A ParadeDB search-function helper received an invalid argument — a malformed query object, an out-of-range numeric option, or an option combination the function does not accept. Raised while authoring/lowering the search expression. Meta: `helper`, `argument`, `received`.

## POSTGIS

### POSTGIS.GEOMETRY_INVALID

A PostGIS geometry constructor (`point`, `polygon`, `bboxPolygon`, …) received invalid input: non-finite coordinates, a ring that is not closed, too few points, or a malformed bounding box. Raised at construction time, before the value reaches the database. Meta: `constructor`, `received`, `reason`.

## SUPABASE

### SUPABASE.CONFIG_INVALID

The Supabase extension's runtime configuration is invalid — missing or contradictory connection/auth settings (formerly the `SupabaseConfigError` class, removed at 0.17). Meta: `reason`.

### SUPABASE.JWT_INVALID

A JWT handed to the Supabase runtime failed validation — malformed token, missing claims, or signature/JWKS mismatch (formerly the `InvalidJwtError` class, removed at 0.17). Meta: `reason`.

## TESTKIT

Raised by the codec conformance testkits (`@internal/postgres-codec-testkit`, `@internal/sqlite-codec-testkit`) while running an extension author's conformance cases against a live database.

### TESTKIT.CODEC_DESCRIPTOR_MISSING

A conformance case names a codec id the target's built-in descriptor registry does not know, and the case supplies no descriptor of its own. The harness projects and decodes through the codec descriptor under test, so an extension codec must be supplied on the case. Meta: `codecId`.

### TESTKIT.CONFORMANCE_CASE_INVALID

A `many` conformance case carries a value that is neither an array nor null — the harness maps element-wise over array cases and has nothing to map over. Give the case an array of element values, or null.

### TESTKIT.PROJECTION_MALFORMED

The executed JSON projection came back in a shape the codec descriptor does not declare: the projected document is missing its value key, or an array projection produced something other than a JSON array or null. This points at the projection SQL the descriptor under test renders. Meta: `codecId` (when the case is known).
