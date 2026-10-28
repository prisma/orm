# Error reference

Every user-facing Prisma 8 error is a structured envelope identified by a dotted `NAMESPACE.SUBCODE` code (see [ADR 239](../architecture%20docs/adrs/ADR%20239%20-%20Errors%20are%20structural%20envelopes%20with%20dotted%20namespace%20codes.md) and [Error Handling](../Error%20Handling.md)). This page lists every published code. It is the canonical source for the hosted reference at `https://docs.prisma.io/docs/orm/v8/reference/error-reference` (each code anchors as `#<CODE>`), and CI verifies completeness on every PR: `pnpm check:error-reference` fails if any code in production source is missing from this page.

Recognize an error programmatically with `isStructuredError` from `@internal/utils/structured-error` and match on `error.code`, never `instanceof`. Envelopes carry `message`, and optionally `why`, `fix`, `where`, `cause`, `docsUrl`, and the structured context each entry below lists as its **Payload**. The payload arrives on `error.meta` when the envelope was built by `structuredError` and on `error.details` when it was built by `runtimeError`; a few codes are raised both ways, so read whichever property the envelope carries.

Exit codes (CLI): an expected structured failure exits `2`, a user abort exits `3`, and `1` is reserved for internal errors (bugs). Codes on this page exit `2` unless the entry says otherwise.

Some codes are not failures to run at all. `db verify`, `db sign` and `migration check` answer a question about the project, and a bad answer is still an answer: they finish, report their findings as diagnostics on a successful envelope, and exit `4`. Exit `2` is reserved for the cases where those commands could not do the job: an unknown `--space`, a migration reference that resolves to nothing, an unreachable database, a contract that has not been emitted. Every entry whose code can arrive on one of those runs says so and names the command. Each of those commands declares the numbers it can exit with, and its `--help` text spells out what each one means.

A command may also **complete with findings**: it ran to its end and has a result to report, and the problems it found ride that result as diagnostics carrying the codes on this page. Those runs exit with a documented per-command code in the `4`–`99` band rather than `2`, and the entry below says so. `prisma orm init` is the case today: its scaffold is on disk whatever happens next, so a failed dependency install or contract emit is a finding on a completed run at exit `4` or `5`.

Codes that predate the dotted scheme were renamed at 0.16; the full old→new crosswalk (`PN-DOMAIN-NNNN` → `NAMESPACE.SUBCODE`) is in [ADR 239](../architecture%20docs/adrs/ADR%20239%20-%20Errors%20are%20structural%20envelopes%20with%20dotted%20namespace%20codes.md).

Namespaces:

| Namespace | Covers |
| --- | --- |
| `CONFIG` | Loading and validating `prisma.config.ts` |
| `CLI` | Command-line argument and invocation errors |
| `CONTRACT` | Contract authoring, emission, validation, and the contract↔database relationship (markers, schema verification) |
| `PSL` | The PSL source text itself (parse, format, interpret), including a Prisma 7 schema read as the contract source |
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

The `contract` section is missing (or incomplete) in `prisma.config.ts` when a command needs it, raised by `prisma contract emit` when the config has no contract configuration, no schema path, or the referenced authoring entrypoint cannot be resolved. Payload: none.

### CONFIG.DB_CONNECTION_REQUIRED

A DB-connected command (`db migrate`, `db init`, `db sign`, `db verify`, `db update`, `db schema`, and the migration scaffold commands) was run with no database connection available: no `--db <url>` flag and no `db.connection` in `prisma.config.ts`. The fix text names the exact retry command when known. Payload: `missingFlags` (optional).

### CONFIG.DRIVER_REQUIRED

A DB-connected command was run but `prisma.config.ts` has no control-plane `driver` entry (e.g. `driver: postgresDriver`). Raised by the migration command scaffold, `db migrate`, `db sign`, `db verify`, and `db schema`. Payload: none.

### CONFIG.EVALUATION_FAILED

The config module could not be evaluated at all: a syntax error in `prisma.config.ts`, or the module threw during import. Raised by the config loader for any command that needs config; loading fails outright (no per-section diagnostics are possible for a module that does not evaluate) and every command exits `2` with this error. The underlying evaluation error's message is carried in `why` and the original error in `cause` (in-process only). The path, when known, is carried in `where.path`. Payload: none.

### CONFIG.FAMILY_READ_MARKER_REQUIRED

Reserved: `db verify` needs the family package to export `verify.readMarker()` and it is absent. Declared in the shared error factories but not raised by any command today.

### CONFIG.FILE_NOT_FOUND

No `prisma.config.ts` (or the explicitly passed config path) could be found when loading configuration, raised by the config loader for any command that needs config. The fix is to run `prisma orm init` to create one. The path, when known, is carried in `where.path`. Payload: none.

### CONFIG.MISSING_EXTENSION_PACKS

The contract declares extension packs that the CLI config does not provide matching descriptors for; raised when resolving framework components for any command that loads the contract. The fix is to add the missing extension descriptors to `extensions` in `prisma.config.ts`. Payload: `missingExtensionPacks`, `providedComponentIds`.

### CONFIG.QUERY_RUNNER_FACTORY_REQUIRED

Reserved: `db verify` needs `db.queryRunnerFactory` in `prisma.config.ts` and it is absent. Declared in the shared error factories but not raised by any command today.

### CONFIG.VALIDATION_FAILED

`prisma.config.ts` loaded but a config section is missing or malformed, as seen by the ORM's own config loader (the language server, the vite plugin, and any tool that calls `loadConfig` outside a command run). The loader validates the `orm` section against its schema and returns one diagnostic per problem, each tagged with the top-level subsection it concerns (`meta.section`: `family`, `target`, `adapter`, `driver`, `extensions`, `db`, `contract`, `migrations`, or `formatter`); a command fails with the diagnostic (exit `2`) only when it reads that section. Under the `prisma` CLI the same problems are reported by the engine instead, as `CLI.CONFIG_FIELD_INVALID` diagnostics (one per field, `meta.section: 'orm'`, `meta.field` the dotted path, `where.path` the config file that declared the field) accompanying `CLI.CONFIG_SECTION_INVALID`. Also raised by framework-component resolution for fields like `frameworkComponents[]`, `frameworkComponents[].kind`/`familyId`/`targetId`, `contract.targetFamily`, and `contract.target`, and by contract-path resolution when `config.contract.output` is absent (those sites carry no `section`). Payload: `field` (loader diagnostics), `section` (loader diagnostics; optional elsewhere).

### CONFIG.VERSION_MARKER_MISSING

The config module evaluated, but its default export was not created by the current `defineConfig`: a plain object export, a spread copy of a `defineConfig` result, or a config produced by a different `defineConfig` (for example a classic Prisma 7 config file). Raised by the config loader before validation; loading fails outright and every command exits `2` with this error. The fix is to create the config with `defineConfig` (imported from your target package's `/config` entrypoint, for example `@prisma/orm-postgres/config`) and export its return value directly. The path, when known, is carried in `where.path`. Payload: none.

## CLI

### CLI.CONFIG_ARG_MISSING_PATH

The migration-file CLI (`prisma migration`) received `--config` without a path argument, either a bare trailing `--config`, or `--config` immediately followed by another flag (e.g. `--config --dry-run`). The CLI fails fast instead of consuming the next flag as the config path or silently falling back to default config discovery. Payload: `nextToken` (present only when another flag followed `--config`).

### CLI.CONSENT_REQUIRED

Raised by the CLI engine, not by Prisma ORM's own code; the engine's entry is the reference: [CLI.CONSENT_REQUIRED](https://docs.prisma.io/docs/cli/error-reference#CLI.CONSENT_REQUIRED). `migration plan` and `db update` raise it when the plan would lose data, or for `db update` change who can read or write data, and the run has nobody to answer: it is not interactive, or `--yes` is set. The command asks one question per model, field or storage name whose data an operation would lose, and `db update` also one per operation that would change who can read or write a model's data, such as disabling row-level security on Postgres. The error lists every question still unanswered, with the flags that answer each: `--delete <subject>` lets the plan lose that data (for a type change, it keeps the field and runs the database's own cast), for a model or field `--rename <subject>:<new name>` keeps it under a new name, for a field whose type changes, `migration plan` also offers `--convert <field>`, which writes a slot for the conversion, and `--allow <subject>` lets `db update` change who can read or write that model's data. Data no model of the origin contract stores can only be deleted. A field of a model the plan renames is named through the model's new name: after `--rename Profile:User`, the question about the dropped `nickname` field is answered with `--delete User.nickname` or `--rename User.nickname:User.handle`. A field whose model the destination names differently, with no statement renaming the model, is offered only `--delete`, and the question says to pass `--rename <Model>:<new model name>` first; the next question then offers the field rename. On MongoDB, removing a field from a model is asked about too, and `--delete` removes it from every document that holds it; with no snapshot of the origin contract the field is named `<collection>.<field>`. Nothing is written or applied. `--confirm` does not answer these questions. Payload: `subject`, `verbs`, `unanswered` (each with its `subject` and `verbs`).

### CLI.CONSENT_UNUSED

Raised by the CLI engine; the engine's entry is the reference: [CLI.CONSENT_UNUSED](https://docs.prisma.io/docs/cli/error-reference#CLI.CONSENT_UNUSED). `migration plan` and `db update` raise it when a `--delete` or `--allow` value answers no question the plan asks, for example a mistyped name or a model the plan does not drop, before they write or apply anything. A `db update --dry-run` asks no questions; it checks its `--delete` and `--allow` values against the subjects an apply would ask about and refuses an unmatched one with `MIGRATION.STATEMENT_ANSWERS_NO_QUESTION` instead.

### CLI.CONTRACT_ARG_CONFLICT

`prisma db sign` was given a contract reference twice, once as the positional argument and once as `--contract`, and there is no rule for which one wins. Pass it once. Payload: `positional`, `flag`.

### CLI.ADVANCE_REF_ARG_CONFLICT

`prisma db sign` was told both which ref to advance (`--advance-ref <name>`) and not to advance any ref (`--no-advance-ref`), and there is no rule for which one wins. Pass one of them. Payload: `advanceRef`.

### CLI.FILE_NOT_FOUND

A file the command needs does not exist at the given path. Produced by several commands: the migration command scaffold, `db migrate`, `migration plan`, `migration show`, `db sign`, `db update`, `db verify`, and `migration ref` all raise it when the emitted `contract.json` (or another required file) is missing from the expected location. Most sites carry the path in `where.path`; the `migration new` contract-file site carries it in the summary text only. Payload: none.

### CLI.FILE_WRITE_FAILED

Writing a file failed: currently raised when `contract format` cannot write the formatted PSL source back to disk (e.g. the file is not writable). The underlying failure is attached as `cause`. Payload: none.

### CLI.INIT_AUTHORING_SCHEMA_PATH_MISMATCH

During `prisma orm init`, `--authoring` and `--schema-path` disagree on file extension, for example `--authoring psl` with a schema path ending in `.ts`. Raised before any scaffold files are written, so the project tree stays untouched. Payload: `authoring`, `schemaPath`, `actualExtension`, `expectedExtension`.

### CLI.INIT_EMIT_FAILED

During `prisma orm init`, the `prisma contract emit` step failed after a successful dependency install. Scaffolded files and installed dependencies remain on disk; the user fixes the contract file and re-runs the emit command. `orm init` completes with this as a finding and exits 5. Payload: `filesWritten`, `cause`.

### CLI.INIT_FLAG_CONFLICT

`prisma orm init --from-prisma7-schema <path>` was combined with `--schema-path` or `--authoring`. The first names an existing Prisma 7 schema as the contract source; the other two describe a starter schema to write, so the pair contradicts itself. Raised before anything is read or written. Maps to init exit code 2 (PRECONDITION). Payload: `flags` (the two kebab-case flag names).

### CLI.INIT_INSTALL_FAILED

During `prisma orm init`, dependency installation failed and the pnpm-to-npm fallback either did not apply or also failed. On a normal run the scaffold is already on disk, and the next actions carry the install command that was attempted and the emit that was waiting on it. On the Prisma 7 path the first install runs before anything is written, to check that the target package can read the schema; when that install fails, `filesWritten` is empty and the next action is to run `orm init` again once the dependencies install. `orm init` completes with this as a finding and exits 4. Payload: `filesWritten`, plus `install` (the attempted command, the manager, its exit code and the tail of its stderr).

### CLI.INIT_INVALID_FLAG_VALUE

A flag passed to `prisma orm init` has a value outside its allowed set (for example `--target` with something other than `postgres` or `mongodb`). Maps to init exit code 2 (PRECONDITION). Payload: `flag`, `value`, `allowed`.

### CLI.INIT_INVALID_MANIFEST

`prisma orm init` could not parse the project's `package.json` as JSON. Init reads the manifest to merge scripts and to skip `@types/node` when already declared, so a malformed file is a hard precondition failure the user can fix and re-run. Maps to init exit code 2 (PRECONDITION). Payload: `path`, `cause`.

### CLI.INIT_INVALID_OUTPUT_DOCUMENT

`prisma orm init` completed but its own success output document failed schema validation. This indicates a bug in Prisma 8 itself, not user error. The engine-hosted `orm init` settles it as an errored envelope at exit 2 (the commander `orm init`, deleted in the S5 cutover, mapped it to exit 1), because the ORM's error boundary converts every failure into a structured settlement and the engine reserves exit 1 for a throw that reaches it uncaught. Payload: none.

### CLI.INIT_INVALID_TSCONFIG

`prisma orm init` could not parse the project's existing `tsconfig.json`, even with JSONC tolerance (comments and trailing commas). Init merges required compiler options into it, so an unreadable file blocks the run; raised before any scaffold file is written. Maps to init exit code 2 (PRECONDITION). Payload: `path`, `cause`.

### CLI.INIT_MISSING_FLAGS

`prisma orm init` ran non-interactively (e.g. `--yes`, or stdin is not a TTY) but one or more required inputs (`--target`, `--authoring`, `--schema-path`) were not supplied as flags. Every missing flag is listed so scripts and agents can react without parsing English. When detection found a Prisma 7 project, the message also names `--from-prisma7-schema <path>` as the alternative; a Prisma 6 MongoDB project gets `CLI.INIT_PRISMA6_SCHEMA_FOUND` instead. Maps to init exit code 2 (PRECONDITION). Payload: `missingFlags`, `prisma7SchemaPath` (`null` when nothing Prisma 7 was found).

### CLI.INIT_PRISMA6_SCHEMA_FOUND

`prisma orm init` found a Prisma 6 MongoDB schema (a `datasource` with `provider = "mongodb"`, which Prisma 7 does not have) where the Prisma 6 CLI looks for it (the path a Prisma 6 `prisma.config.*` or the `prisma.schema` field of `package.json` names, else `prisma/schema.prisma`, `schema.prisma` or the `prisma/schema` folder), or at the path `--from-prisma7-schema` names. Prisma 8 can read that schema through `prisma6Schema`, but init does not set it up: both CLIs are published as `prisma`, and the Prisma 6 CLI also reads `prisma.config.ts`. Init stops before asking, installing, or writing anything, and its next actions are the side-by-side setup: move the Prisma 6 CLI to an npm alias (`"prisma6": "npm:prisma@<version>"`) run through a `prisma6` script with its own config file, install Prisma 8, write `prisma.config.ts` with `prisma6Schema`, then run `contract emit` and `db sign`. Passing `--target` and `--authoring` skips this and sets up a starter in the same project, with a warning that it breaks the Prisma 6 CLI: the `prisma.config.ts` it writes makes every Prisma 6 command fail until Prisma 6 gets its own config file, and its install step replaces the Prisma 6 CLI with `prisma@latest`. Maps to init exit code 2 (PRECONDITION). Payload: `schemaPath`, `prismaConfig` (the Prisma 8 config to write), `prisma6Config` (the Prisma 6 config to write; `null` when the project's own `prisma.config.*` is to be renamed instead).

### CLI.INIT_PRISMA7_CONFIG_COLLISION

On the Prisma 7 path of `prisma orm init`, `prisma.config.*` evaluated as a Prisma 7 config (no `$prismaConfig` marker) while a `prisma7.config.*` also exists. Init renames the Prisma 7 config to `prisma7.config.*` so Prisma 8 can write its own, and cannot rename onto an existing file. Nothing is written. Maps to init exit code 2 (PRECONDITION). Payload: `prismaConfigPath`, `prisma7ConfigPath`.

### CLI.INIT_PRISMA7_CONFIG_UNREADABLE

On the Prisma 7 path of `prisma orm init`, `prisma.config.*` exists but failed to evaluate (typically a Prisma 7 config importing `prisma/config` in a checkout whose dependencies are not installed). Init cannot tell whether the file is Prisma 7's, to rename, or its own, to replace, so it refuses rather than overwrite it. The fix is to install the project's dependencies so the config evaluates, or rename it to `prisma7.config.<ext>` by hand; when a `prisma7.config.*` already exists, init leaves `prisma.config.*` alone and the fix is to install the dependencies and fix the error in it instead. The normal path is unaffected: without the flag or a yes to the Prisma 7 question, the file is treated as it is today. Nothing is written. Maps to init exit code 2 (PRECONDITION). Payload: `path`, `why`, `prisma7ConfigPath` (`null` when none exists).

### CLI.INIT_PRISMA7_PROVIDER_UNSUPPORTED

On the Prisma 7 path of `prisma orm init`, the schema's `datasource` block declares a provider Prisma 8 has no target for, or no string provider at all. The supported list is in the payload. When the provider is not a string literal, passing `--target` names the database instead; a string provider with no target is refused whatever `--target` says. Nothing is written or installed. Maps to init exit code 2 (PRECONDITION). Payload: `schemaPath`, `provider` (`null` when not a string literal), `supported`.

### CLI.INIT_PRISMA7_SCHEMA_INVALID

The path `prisma orm init` was asked to use as a Prisma 7 schema (`--from-prisma7-schema`, or the path the interactive question named) does not exist, or neither it nor any `.prisma` file under it has a `datasource` block. Nothing is written. Maps to init exit code 2 (PRECONDITION). Payload: `schemaPath`, `reason` (`absent` or `no-datasource`).

### CLI.INIT_PRISMA7_SCHEMA_REFUSED

On the Prisma 7 path of `prisma orm init`, the target package's Prisma 7 contract source refused the schema, for example because it contains a `view` block. Init runs the source after installing the target package and `dotenv` and before any consent question or file change, so the project is unchanged apart from those two packages. The `why` lists each diagnostic as `<sourceId>:<line>:<column> <code> <message>`. The next actions say to edit the schema as each finding says (the target package's README lists every refusal and its fix) or to run init without `--from-prisma7-schema`, and give the command that removes the two packages. Maps to init exit code 2 (PRECONDITION). Payload: `schemaPath`, `summary`, `diagnostics`, `packagesAdded` (the packages the project did not declare before the check; the remove command names only these).

### CLI.INIT_PRISMA7_SOURCE_UNAVAILABLE

On the Prisma 7 path of `prisma orm init`, the target package cannot read the Prisma 7 schema. Either it has no `prisma7Schema` export while `--from-prisma7-schema` asked for one (`reason: no-prisma7-source`), or it could not be loaded from the project after init installed it (`reason: not-resolvable`). When the user entered the Prisma 7 path by answering yes to init's question instead of passing the flag, a package without `prisma7Schema` is not an error: init warns and runs as a fresh init. Nothing is written apart from the target package and `dotenv` the check installed, and the next actions give the command that removes them. Maps to init exit code 2 (PRECONDITION). Payload: `schemaPath`, `packageName`, `reason`, `packagesAdded` (the packages the project did not declare before the check).

### CLI.INIT_PRISMA7_TARGET_MISMATCH

On the Prisma 7 path of `prisma orm init`, `--target` names a different database than the schema's `datasource` provider, for example `--target mongodb` for a schema that declares `provider = "postgresql"`. With `--from-prisma7-schema` it is refused before anything is asked, installed, or written. Without the flag init does not ask its Prisma 7 question and runs as a fresh init, so this code is not raised. Maps to init exit code 2 (PRECONDITION). Payload: `schemaPath`, `provider`, `target` (as passed).

### CLI.INIT_PROBE_FAILED

`prisma orm init --probe-db --strict-probe` was run and the database probe could not complete (no `DATABASE_URL`, network or auth error, driver not installed). Without `--strict-probe` these surface as warnings; strict mode escalates them to fatal. Scaffolded files are already on disk when this fires. Maps to init exit code 2 (PRECONDITION). Payload: `filesWritten`, `cause`.

### CLI.INIT_REINIT_NEEDS_FORCE

`prisma orm init` ran non-interactively in a directory that already has a `prisma.config.ts`, and consent to overwrite the existing scaffold was not given. Re-scaffolding is destructive, so it needs explicit consent: interactively, `orm init` asks the user to type the working directory's name back; non-interactively, the same consent is granted by `--confirm <directory name>`. Neither `--yes` nor any flag skips it. Maps to init exit code 2 (PRECONDITION). Payload: none.

The code was raised by the commander `orm init` (deleted in the S5 cutover), whose consent flag was `--force`. The engine-hosted `orm init` reaches the same outcome through the engine's own `CLI.CONSENT_REQUIRED`, which names the exact `--confirm` value to pass.

### CLI.INIT_SKILL_INSTALL_FAILED

Retired. `prisma orm init` used to fetch the agent skills from GitHub with `skills add`, and raised this at exit `6` when that fetch failed. The skills now ship inside the `@prisma/orm-*` packages a project installs, and `orm init` no longer touches them at all: skills setup belongs to the family-level `prisma init` command, and `prisma skills sync` copies the skills out of the installed packages whenever it runs. Init's remaining failure exits are `4` (dependency install failed) and `5` (contract emission failed); there is no exit `6`, and nothing raises this code.

### CLI.INIT_STRICT_PROBE_WITHOUT_PROBE

`prisma orm init --strict-probe` was supplied without `--probe-db`. Init is offline-by-default, so no probe runs without `--probe-db`; rather than silently ignoring the strict flag, init errors and tells the user to add `--probe-db` or drop `--strict-probe`. Maps to init exit code 2 (PRECONDITION). Payload: none.

### CLI.INIT_USER_ABORTED

The user cancelled an interactive `prisma orm init` prompt (Ctrl-C, escape, or declining a selection) before all required inputs were supplied. No files were modified. Severity is `info`, not `error`; maps to init exit code 3 (USER_ABORTED). Payload: none.

Raised by the commander `orm init` (deleted in the S5 cutover). On the engine-hosted `orm init` a cancelled prompt is the engine's own `CLI.PROMPT_CANCELLED`, which exits 3 for every command rather than only this one; the engine-hosted `orm init` keeps this code for a consent the user declines, which settles as an errored envelope at exit 2 like every other structured failure there. Because that command's consent declares a token, the engine answers a wrong or absent answer with `CLI.PROMPT_INVALID` or `CLI.CONSENT_REQUIRED` before a decline can be expressed, so the code is the refusal that runs if a future consent drops its token.

### CLI.INIT_WRITE_FAILED

`prisma orm init` could not write one of the files it scaffolds: a directory sitting where the file goes, permissions, a full disk. Everything that can be read and parsed is checked before the first write, so this is the failure that survives that check; the files written before it are already on disk and are listed so a follow-up run or agent knows the state it is resuming from. On the Prisma 7 path the config rename happens before the first write, so a completed rename is listed too (`filesRenamed`, `from` and `to`); it stays in place and a re-run writes the missing files beside it. Maps to init exit code 2 (PRECONDITION). Payload: `path`, `cause`, `filesWritten`, `filesRenamed`.

### CLI.INVALID_OUTPUT_FORMAT

The main CLI received a `--format` value other than `pretty` or `json`. Raised during global-flag resolution, before any command logic runs. Payload: `value`, `allowed`.

### CLI.INVALID_VERIFY_MODE

`prisma db verify` was given a contradictory mode combination: `--marker-only` together with `--schema-only`, or `--strict` together with `--marker-only` (strict requires schema verification, which marker-only skips). Payload: none.

### CLI.JSON_FORMAT_UNSUPPORTED

Reserved: a command was asked for a `--json` sub-format it does not support; the error lists the formats the command does accept. Declared in the shared error factories but not raised by any command today. Payload: `command`, `format`, `supportedFormats`.

### CLI.MIGRATION_CONFIG_NOT_FOUND

Running a `migration.ts` with node and no `--config` found no config that owns the migration. Without `--config`, the file uses the config whose migrations directory holds it: the nearest `prisma.config.ts` above the migration's directory if it owns it, else the `prisma.config.ts` in the working directory if that one does. The message names each config it checked, with the migrations directory it keeps or the reason it failed to load, and says to run the file again with `--config <path>`. Payload: `migrationDir`, `checked`.

### CLI.OUTPUT_FORMAT_CONFLICT

The main CLI received mutually exclusive output flags: `--format pretty` together with `--json`. Use `--format json` or `--json` alone for JSON output. Payload: none.

### CLI.PROJECT_MANIFEST_INVALID

A `package.json` found while resolving the project import root is not valid JSON, or parses to something other than a JSON object. Emission reads the nearest manifest to decide which package names generated files should import; fix the manifest's JSON and re-run. The parse failure (when there is one) is attached as `cause`. Payload: `path`.

### CLI.PROJECT_MANIFEST_UNREADABLE

A `package.json` found while resolving the project import root exists but could not be read (e.g. a permissions failure). Absent manifests continue the walk up; a read failure stops it, because silently skipping would emit against the wrong project's dependencies. The read failure is attached as `cause`. Payload: `path`.

### CLI.PROMPT_REQUIRED

Raised by `@prisma/cli-engine`, not by this repository: a command asked a question that has no default, and the session could not show it: stdin is not a terminal, `--no-interactive` was passed, or `--yes` was asked to answer a prompt that declares no default. The `CLI` namespace is shared with the engine (see [ADR 239](../architecture%20docs/adrs/ADR%20239%20-%20Errors%20are%20structural%20envelopes%20with%20dotted%20namespace%20codes.md)); it is listed here because it settles runs of the ORM's commands. `prisma orm init` translates it for the two prompts that stand in for a required flag, so a missing `--target` or `--authoring` still reports `CLI.INIT_MISSING_FLAGS` with the full missing list. Payload: none.

### CLI.UNEXPECTED

Catch-all for an unanticipated failure inside a CLI command: an unclassified exception is wrapped in this envelope with the original message in the `why`, without the connection string. Thrown across nearly every command (migrate, db init/sign/update/verify, migration plan/new/show/status/log, contract emit, ref, inspect-live-schema, config loading). Payload: `code`, when the exception carried one that is not a structured code, such as a driver's `ECONNREFUSED` or a SQLSTATE; otherwise none.

### CLI.UNKNOWN_FLAG

The migration-file CLI (`prisma migration`) received a flag it does not recognise; wraps clipanion's unknown-syntax error at the parser boundary so consumers can build "did you mean" suggestions from meta instead of parsing the message. Payload: `flag`, `knownFlags`.

## CONTRACT

### CONTRACT.ARGUMENT_INVALID

A builder or helper on the contract-authoring surface is called with a bad argument: a composed authoring helper receives too many arguments or a malformed trailing options object, `field.sql({ id })` / `field.sql({ unique })` is used without a matching inline `.id(...)` / `.unique(...)` declaration, `model("Name", ...)` is called without a model definition, a nanoid ID generator is given a size outside 2–255, a TypeScript `type.*` type constructor receives an argument its data type's parameter schema refuses (meta: `helperPath`, `argumentIndex`; see `CONTRACT.TYPE_PARAMS_INVALID` for how PSL and the contract build report the same bound), or an authored index combines its cross-field parameters invalidly (fields and an expression together or neither, an expression without `name:`/`map:`, or `map:` combined with `name:`). Also raised by the Mongo TypeScript builder when two variants of a polymorphic base declare the same discriminator value (meta: `modelName`, `value`, `variants`, `reason: 'duplicate-discriminator-value'`). Also raised by the Mongo TypeScript builder for `.mongo({ field })` on a field of a value object, whose fields are stored under their own names (meta: `valueObjectName`, `fieldName`, `reason: 'value-object-field-stored-name'`). Also raised by the Mongo TypeScript builder for a model field stored as `__proto__`, which JavaScript reads as the prototype of an object rather than as a key (meta: `modelName`, `fieldName`, `reason: 'stored-name-unsupported'`); the Mongo PSL interpreter reports the same case at the field as `PSL_STORED_NAME_UNSUPPORTED`, and reading `contract.json` back refuses a field or embed relation stored as `__proto__`. Also raised when a contract targets SQLite and declares an expression or partial index: SQLite's namespace construction rejects `expression:`/`where:` because the target does not support them. Also raised when a column with a literal default has type parameters that its codec does not accept beyond its data type's parameters, which the build checks first with `CONTRACT.TYPE_PARAMS_INVALID` (meta: `modelName`, `fieldName`, `codecId`, `reason: 'type-params-invalid'`; the codec's error is the `cause`). Also raised by a SQL contract build for a relation's `index: "<name>"` that names nothing on its table, matches more than one index, unique constraint or primary key of its table, by the `name` or `map` the source gave it or an index's stored name, names an object whose first columns are not the foreign key's columns, or names an index of a type whose body is rendered from its options rather than its columns, such as Postgres's `fullText` (meta: `reason: 'foreign-key-index-unresolved'`, `namespaceId`, `tableName`, `columns`, `index`); a PSL source reports it as `PSL_INVALID_RELATION_ATTRIBUTE` at the relation. Also raised when two identical indexes of one table are both named with `name:`, whose wire names the planner could not tell apart (meta: `tableName`, `indexes`). Also raised by `requireSqlExpression` when a TypeScript builder field that takes raw SQL (`index` `where` or `expression`, `check` `expression`, `fullTextIndex` `where`, a policy's `using` or `withCheck`) holds something other than a `sql` value at run time, which only JavaScript that is not type-checked can pass (an object that carries the `sql` value marker but whose `text` is not a string counts as something else): ``Index "post_user_active" where must be a sql`...` value.`` (meta: `what`, which names the object and the field: `Index "<name>" where`, `Index "<name>" expression`, `Check "<name>" expression`, `Full-text index "<name>" where`, `Policy "<name>" using`, `Policy "<name>" withCheck`; an index or check with no `name` or `map` is named by its model, as in `Index on "<Model>" where`, and a full-text index with neither by its fields in order, as in `Full-text index on fields "<field>", "<field>" where`). Also raised by `sqlTextOf` when a migration-file function that takes a SQL fragment gets something that is neither a string nor a `sql` value: ``createIndex "post_user_active" where must be a string or a sql`...` value.`` (meta: `what`, which names the function, the object and the argument: `fn expression`, `checkExpression "<name>" expression`, `addCheckConstraint "<constraint>" expression`, `createIndex "<index>" expression`, `createIndex "<index>" where`, `createRlsPolicy "<policy>" using`, `createRlsPolicy "<policy>" withCheck`, `alterColumnType "<table>"."<column>" using`, `addColumnWithTemporaryDefault "<table>"."<column>" temporaryDefault`, and on SQLite `addColumn "<table>"."<column>" default`, `recreateTable "<table>"."<column>" default` and `recreateTable "<table>" copyExpressions.<column>`); this one is raised when the migration file runs, not while the contract is built. Also raised by `replaceStoredValue` and `removeStoredValue` in a Postgres or SQLite `migration.ts` for a value that is not a string or a finite number, such as `null`, which matches no row: `replaceStoredValue({ table: "task", column: "state" }): from must be a string or a number; got null` (meta: `what`, the function and the argument, as in `replaceStoredValue from`, `replaceStoredValue to` or `removeStoredValue value`), raised when the migration file runs. Raised too when the call's `codecRef` names a codec that writes the value as neither a string nor a number: `Codec <codecId> writes the stored value <value> as neither a string nor a number, which a migration cannot compare` (meta: `what: 'stored value'`, `codecId`). Otherwise raised while authoring/building the contract, before emit. Payload: varies per site. The MongoDB contract builder also raises it for a polymorphism rule every source shares, worded for TypeScript (meta: `modelName`, and `reason`): a discriminator that is optional, a list or not text (`discriminator-optional`, `discriminator-list`, `discriminator-not-text`, with `fieldName`); a variant's value the discriminator field cannot hold, or that is not a member of the field's enum (`discriminator-value-unreadable`, `discriminator-value-not-a-member`, with `baseModel` and `fieldName`); a model with both a discriminator and a base (`discriminator-and-base`); a discriminator no model names as its base (`discriminator-without-variants`); a listed variant no model declares (`listed-variant-missing`, with `variant`); and a base that has no discriminator, that the contract does not declare, or that names no value for the variant (`base-without-discriminator`, `base-unknown`, `variant-without-value`, with `baseModel`); and a variant field that restates a base field with a different stored name, type, nullability or list shape (`restated-base-field-differs`, with `fieldName`, `baseModel` and `differences`), which Mongo PSL reports as `PSL_VARIANT_FIELD_DIFFERS_FROM_BASE` at the field. Mongo PSL reports the same rules with its own codes, at the `@@discriminator` or `@@base` attribute. `mongoContract(path, options)` raises it when `options.target` is missing (`reason: 'target-pack-missing'`, with `schemaPath`); pass `{ target: mongoTargetPack }`, or name the schema in `defineConfig({ contract })` from `@prisma/orm-mongo/config`.

### CONTRACT.AGGREGATE_DESCRIPTOR_AMBIGUOUS

The SQL emitter cannot name one result type for an aggregate: two trait-matching aggregate descriptors both claim a contributed codec, or a descriptor whose result reuses its input's codec also answers calls that carry no input. Raised while generating `contract.d.ts`, so the emitted types can never disagree with what the runtime registry resolves. Payload: `operation`; plus `codecId` and `traits` when two traits claim one codec, the contested codec being nameable only in that case.

### CONTRACT.AGGREGATE_DESCRIPTOR_DUPLICATE

Two composed components contribute an aggregate descriptor for the same `(operation, input)` overload, keyed as `sum:trait:numeric`, `sum:codec:pg/int8@1`, or `count:none`. Each overload resolves to exactly one result codec, so exactly one target, adapter, or extension may claim it. Raised while the control stack collects contributions (e.g. during `contract emit`); the runtime plane enforces the same rule as `RUNTIME.DUPLICATE_AGGREGATE_DESCRIPTOR`. Payload: `key`, `contributedBy`, `owner`.

### CONTRACT.AGGREGATE_DESCRIPTOR_INVALID

A composed component contributes an aggregate descriptor whose shape the framework cannot read: a missing or empty `operation`, an `input` match that is not `none` / `any` / `codec` / `trait`, an `output` that is not `self` / `codec`, a non-boolean `nullable`, a `nullable: false` descriptor with no `emptyResultWire` (a non-nullable result must declare the value it answers with over no result row), or a `self` output on a match that may carry no input to reuse. Raised while the control stack collects contributions (e.g. during `contract emit`); the runtime plane enforces the same rule as `RUNTIME.AGGREGATE_DESCRIPTOR_INVALID`. Payload: `contributedBy`, `descriptor`.

### CONTRACT.AGGREGATE_OUTPUT_CODEC_MISSING

The SQL emitter is asked to emit an aggregate result row whose declared result codec the composed stack does not contribute: the emitted type would name a codec absent from the contract's codec map, and every consumer reading it would resolve `never`. Contribute the codec, or declare a result codec the stack contributes. Raised while generating `contract.d.ts`. Payload: `operation`, `outputCodecId`.

### CONTRACT.CODEC_DESCRIPTOR_MISSING

The control plane resolves a codec referenced by the contract (a `CodecRef.codecId`) against the contract's pack stack and finds no registered codec descriptor for that id. Hit during control-plane operations (emit, migration tooling) when a contract references a codec no composed pack provides. Payload: `codecId`. Also raised while a SQL contract is authored, when a column or storage type names a codec the contract's packs do not register, so its database type cannot be named from the codec's data type. A TypeScript `contract.ts` hits this when it uses an extension's codec without listing the extension in `defineContract({ extensions })`. List the pack that provides the codec. Payload (meta): `codecId`. The Mongo `defineContract` builder raises it for a model or value object field whose codec no pack in the contract provides, because the collection validator cannot give the field's BSON type: `Model "<model>" field "<field>" uses codec "<codecId>", which no pack in the contract provides, so its BSON type is unknown and the contract cannot describe the field.` (`Value object "<name>"` for a value object field). Payload (meta): `modelName` or `valueObjectName`, `fieldName`, `codecId`.

### CONTRACT.CODEC_JSON_TYPE_MISSING

A contract build derives the check of a value object column on Postgres, and a member of the value object uses a codec whose descriptor declares no `jsonType`, as a codec package compiled before codecs declared one does. The codec's registry accepts it, so an app that does not put the codec in a value object keeps working. The codec's author adds `jsonType`, the JSON type the codec's value is written as inside a JSON document. Payload: `codecId`, `valueObject` (`<namespace>:<name>`), `member`, `property` (`jsonType`).

### CONTRACT.CAST_REFUSED

A value handed to a data type's cast, or to an authoring entry that reads written text, is not one that type takes: it is not in the shape the source type stores, its magnitude is outside the range the receiving type holds, the text is not a boolean, or the text is not a date or time the receiving type holds. A date or time text is refused when it has an offset its type does not hold or lacks one its type needs, has more fraction digits than its type holds (six, or three for `sqlite/datetime@1`, which holds milliseconds), names a date or time that does not exist, or is outside the range of years its type holds; the message shows text the type takes. The date and time codecs raise it from `toDataTypeValue` for a value their type does not hold, such as a `Temporal` value with digits below one microsecond. Raised by a target's or extension's casts and authoring entries. A contract source reading a written value reports it to the author as the PSL diagnostic `PSL_INVALID_LITERAL` when a cast, an authoring entry or a codec's canonical form raised it, and as `PSL_INVALID_DEFAULT_LITERAL` when a codec raised it for a column default. Payload: `why`, `fix`.

### CONTRACT.CHECK_NAME_RESERVED

An authored `@@check` / `check()`'s `name:` prefix matches the shape a derived enforcement check would use for a column of the same table (`<table>_<column>_check`, `<table>_<column>_elem_not_null` or `<table>_<column>_shape`), so it cannot be told apart from a derived check once a non-`managed` table strips those. The message and `collidingColumns` meta name the column(s) whose derived-check shape the prefix matches. Raised while building a SQL contract, once the table's real columns are in hand. The fix is to choose a different `name:`. Payload: `tableName`, `prefix`, `collidingColumns`.

### CONTRACT.CHECK_ON_STI_VARIANT

A model declares `@@check` / `check()` but is a single-table-inheritance variant (`@@base` with no own `@@map`), so it shares its base model's storage table and has no table of its own to declare the check on. Raised while building a SQL contract, as a backstop for the TS authoring path; the PSL surface refuses this earlier, at interpretation, with a span-anchored `PSL_CHECK_ON_STI_VARIANT` diagnostic naming the base model. The fix is to declare the check on the base model instead. Payload: `tableName`, `modelName`.

### CONTRACT.COLLECTION_INVALID

A Mongo model's collection attachment is wrong: the model declares `indexes`, `collectionOptions`, or `controlPolicy` but has no collection, or a single collection has `collectionOptions` / `controlPolicy` declared by more than one model. Also raised for a root model (a model with a collection, no owner and no base) whose field stored as `_id` can hold BSON type `array`, `regex` or `undefined`, which MongoDB refuses as an `_id`, or `null`, since every document has an `_id` (`reason: 'document-id-bson-type'`, with `codecId` and `bsonTypes`): a list, an optional field, a codec such as `mongo/json@1` or `mongo/vector@1`, or a codec that can store any BSON type, such as `mongo/bson@1`. Any other `_id` is accepted, and its validator requires that type; a model may leave `_id` out, and its validator then requires the `objectId` `_id` MongoDB adds. The Mongo PSL interpreter reports the same case, at the field, as `PSL_MONGO_ID_INVALID`. Raised by the Mongo `defineContract` builder. Payload: `modelName`, `collection`, `reason`; for an `_id` refusal also `fieldName`, `codecId` and `bsonTypes`. A variant stored in another collection than its base is refused too (`reason: 'variant-collection-differs'`, with `baseModel` and `baseCollection`); a variant that names no collection is stored in its base's. Mongo PSL reports it as `PSL_MONGO_VARIANT_SEPARATE_COLLECTION`.

### CONTRACT.CONSTRAINT_INVALID

A model declares an empty unique constraint (a unique with no fields), raised during SQL contract lowering (meta: `modelName`). Also raised when a CHECK constraint reaches SQLite migration DDL rendering: the SQLite target does not support CHECK constraints, and `sql.checkConstraint` is a Postgres-only capability. A `@@check` is refused earlier, by the PSL capability gate; a `check()` declared through the TypeScript builder is not, because capabilities reach the contract only after it is built, so this is where a SQLite `check()` is refused (meta: `constraintName`, and `tableName` where available).

### CONTRACT.PRINT_OUTPUT_IS_PROJECT_FILE

`prisma contract print --output` was asked to write over a file the project needs: the `prisma.config.ts` in the directory of the config that defines the `orm` section, or one of the files `contract emit` writes (the JSON `contract.output` names, and the `.d.ts` beside it). Writing there would put PSL where the CLI reads its config when `--config` names no other file, or the next `contract emit` would write over the printed PSL. The check compares the files the paths name: a path through a symbolic link, or one that differs only in case on a volume that ignores case, counts as the same file. Raised before the source is read, so nothing is written. Pick another `--output` path. Payload: `output` and `file`, both relative to the invocation directory.

### CONTRACT.PRINT_OUTPUT_IS_SOURCE

`prisma contract print --output` was asked to write over a file it reads: the resolved `--output` path is one of the contract source's inputs, or sits inside a directory of source files. Writing there would destroy the source the printed contract is made from. The same code is raised when the path names a new file that a glob input of the source would match once written, because the next `contract emit` would read the printed file together with the source files; `source` is then the glob. Pick another `--output` path, outside the files the config names. Raised before the source is read, so nothing is written and the source file is untouched. Payload: `output` and `source`, both relative to the invocation directory.

### CONTRACT.PRINT_UNSUPPORTED

`contract print` cannot write the loaded contract as Prisma 8 PSL that reads back as the same contract, so it writes nothing. The message names what it stopped on. Raised when the configured family cannot print a contract (no meta), or when the target's descriptor has no `buildPslContract` hook (meta: `targetId`). The Postgres printer raises it in each case below; each case is one function in its `psl-print/refusals.ts`, in this order. Every case is a contract that passes validation. The printer takes a validated contract and does not check its structure again.

- Column types and defaults:
  - no PSL type in the configured stack produces a column's codec, data type and type parameters, including a column that has no value for an argument its type constructor requires. Add the extension that contributes the type to the config (meta: `coordinate`, `dataType`, `codecId`);
  - a string type argument holds a quote, backslash or line break, which the PSL source reads back differently (meta: `coordinate`, `argument`);
  - a domain enum column defaults to a value that is not a member of the enum (meta: `coordinate`, `pslTypeName`);
  - a column's literal default has no PSL literal that reads back as the stored value, including when the column's codec has no data type in the stack (meta: `coordinate`, `pslTypeName`).
- Generated values:
  - a list column has a generator, which Prisma 8 PSL refuses on a list field (meta: `coordinate`, `phase`, `generatorId`);
  - a column is generated by a generator that no generator function in the configured stack writes for the column's codec. When no component in the stack registers the generator, add the extension that registers it and its generator function to the config. When a configured component registers it, the message names that component: if it declares a generator function that produces the generator, its author must bind that function to the column's codec, as the upgrade instructions `default-generators-to-on-create` for extension authors describe. Until then, keep the current contract source (meta: `coordinate`, `phase`, `generatorId`, `codecId`, and `componentId` when the registering component has an id);
  - the `@onCreate(fn(…))` or `@onUpdate(fn(…))` call contract print would write for a column's generator resolves back to another generator or other params, such as `plainTimeNow` with no params on a `time(3)` column, whose `now()` takes `precision: 3` (meta: `coordinate`, `phase`, `call`, `stored`, `readBack`).
- Fields and columns:
  - a field and its column disagree where PSL writes them once: the field is optional and the column is not nullable or the reverse, a column of a single-table variant is not nullable, one of them is a list and the other is not, a scalar field's codec or type parameters differ from its column's, or they do not name the enum and value set the PSL source derives for a field typed by an enum (meta: `coordinate`);
  - a model field's or value-object member's type is a union of types (meta: `coordinate`, `kind`), or a field or member is a dictionary (meta: `coordinate`);
  - a value-object member typed by an enum names a value set other than the enum of the default namespace the PSL source derives, has a codec other than that enum's, or has type parameters (meta: `coordinate`);
  - a value-object member uses a codec that no Postgres codec in the configured stack names a native type for (meta: `coordinate`, `codecId`);
  - a value-object member uses a codec that names a native type only from type parameters the member does not carry (meta: `coordinate`, `codecId`);
  - a model stores a column under a field name the model does not declare (meta: `namespaceId`, `modelName`, `field`);
  - a column has its own control policy (meta: `coordinate`, `control`);
  - a table has no model stored in it (meta: `namespaceId`, `table`), or a column is stored by no field, other than the primary key columns that link a multi-table variant to its base (meta: `namespaceId`, `table`, `column`).
- Models:
  - a model has an owner (meta: `namespaceId`, `modelName`, `owner`);
  - a multi-table variant is linked to its base other than through the base's primary key columns as its unnamed primary key and an unnamed foreign key that cascades on delete (meta: `namespaceId`, `modelName`);
  - one model name is declared in more than one namespace (meta: `modelName`, `namespaces`);
  - a domain enum is declared outside the default namespace (meta: `namespaceId`, `names`);
  - a domain enum member stores a value that no PSL literal of the enum codec's data type reads back as, including when the codec has no data type in the stack (meta: `enumName`, `member`);
  - a value object is declared outside the default namespace (meta: `namespaceId`, `names`).
- Keys, checks and indexes:
  - a check or index has a prefix, but its name is not that prefix followed by the hash of its content (meta: `namespaceId`, `table`, `name`, `prefix`);
  - a managed table lacks a check the PSL source derives for an enum or list column, or has a check with that check's name but not its prefix and expression (meta: `namespaceId`, `table`, `name`);
  - an index has options but no type (meta: `namespaceId`, `table`, `index`), or an option whose value is not a string (meta: `namespaceId`, `table`, `index`, `key`);
  - an index's `expression` or `where`, a check's `expression` other than a derived check's, a policy's `using` or `withCheck`, or a column's function default holds SQL that a `sql` literal cannot write back unchanged, because reading the literal removes indentation shared by every line, blank lines at the start or end, a carriage return or a whitespace-only line. Write the SQL in that canonical form in the contract's source (meta: `namespaceId`, `table`, `name`; for a policy `namespaceId`, `table`, `policy`; for a default `coordinate`). `contract infer` prints such a default with a note instead; [ADR 268](../architecture%20docs/adrs/ADR%20268%20-%20Raw%20SQL%20is%20a%20value%20of%20the%20data%20type%20sql-expression.md#column-defaults-that-do-not-read-back) explains why the two commands differ.
- Relations:
  - a to-one relation has no foreign key behind it (meta: `model`, `field`);
  - a relation's foreign key is backed by a primary key or unique constraint that has more columns than the foreign key and no name, so its `@relation` cannot name it with `index:` (meta: `model`, `field`);
  - a foreign key has no relation that travels it (meta: `namespaceId`, `table`, `columns`);
  - a relation targets a model in another contract space, which the printer does not write yet (meta: `model`, `field`, `space`);
  - a many-to-many relation goes through a table whose model has no relation back to the relation's model (meta: `model`, `field`);
  - a one-to-many or one-to-one relation has no foreign key of its own, and the model it targets has no relation back that holds the foreign key (meta: `model`, `field`);
  - a relation names no fields to join on (meta: `model`, `field`).
- Enums and value sets:
  - a value set is not the value set of an enum or native enum of that name holding exactly its values, or an enum has no value set holding its members (meta: `namespaceId`, `name`);
  - an enum and a native enum would derive the same value set (meta: `namespaceId`, `name`);
  - a native enum has no value set holding its members (meta: `namespaceId`, `typeName`);
  - a native enum has its own control policy (meta: `namespaceId`, `typeName`, `control`).
- Namespaces, meta and roots:
  - a storage or domain namespace holds nothing PSL writes, or the contract lacks a namespace the PSL source would create, such as the default namespace (meta: `plane`, `namespaceId`);
  - a namespace is named `unbound` and is not the late-binding namespace, which PSL writes as `namespace unbound` (meta: `namespaceId`);
  - the contract has top-level `meta` entries (meta: `keys`);
  - the contract has roots other than one per model that is not a variant, keyed by its table name (meta: `root`);
  - the contract registers database types in `storage.types`, which PSL cannot declare: `This contract registers the database types <names>, which PSL cannot declare. It is an extension's contract space, written in TypeScript.` Only the pgvector and PostGIS contract spaces do (meta: `types`).
- Row-level security:
  - a table has row-level security enabled but no model (meta: `namespaceId`, `table`);
  - a policy is on a table with no model (meta: `namespaceId`, `table`, `name`);
  - a policy is on a table without row-level security (meta: `namespaceId`, `table`, `name`);
  - a wire-named policy's name is not its block name followed by the hash of its content (meta: `namespaceId`, `table`, `name`);
  - a role is declared outside the unbound namespace (meta: `namespaceId`, `name`);
  - a row-level security setting or role is filed under a key the PSL source would not file it under (meta: `namespaceId`, `kind`, `name`);
  - a row-level security setting, role or policy records a namespace other than the one it is stored in (meta: `namespaceId`, `kind`, `name`).
- Names and storage entries:
  - a table or column is named `__proto__`, which the PSL source loses when it reads the name from `@@map` or `@map` (meta: `kind`, `name`);
  - a name PSL writes as an identifier is not one, or is `__proto__`: a namespace, model, field, value object, enum, enum member, native enum, policy, role or index option key. `NaN` and `Infinity` are number words, not identifiers (meta: `kind`, `name`);
  - a namespace holds a storage entity kind other than tables, value sets, native enums, row-level security settings, policies and roles (meta: `namespaceId`, `kind`, `names`).

### CONTRACT.DATA_TYPE_CASTS_FROM_SQL_EXPRESSION

A data type in the composed stack declares a cast or a list cast from `sql/expression`: `Data type "<id>" from "<contributedBy>" declares a cast from sql/expression. No data type may cast from sql/expression: a sql literal is SQL the database runs, not a value of another type.` Such a cast would turn a `sql` literal into a value of another type with no diagnostic. Raised by the SQL family when it creates its control instance, which the CLI does before it emits, prints, infers, plans or verifies a contract. The language server does not create one and does not report it. Remove the cast from the component the message names. Payload: `dataType`, `contributedBy`.

### CONTRACT.DATA_TYPE_DUPLICATE

Two components in the composed stack register the same data type id, which has exactly one owner. Raised while assembling the stack's data types. Payload: `dataType`, `contributedBy`, `owner`.

### CONTRACT.DATA_TYPE_ENTRY_DUPLICATE

Two components contribute an authoring entry under the same key, so the stack cannot tell which one reads that data type's written form. Raised while merging authoring contributions. Payload: `key`, `contributedBy`, `owner`.

### CONTRACT.DATA_TYPE_ID_INVALID

A string given where a data type id belongs is not `owner/name` in lower case, or carries a version (a versioned id names a codec, not a data type). Raised by `dataTypeId()` while declaring a data type or a cast. Payload: `id`.

### CONTRACT.DATA_TYPE_NOT_WRITABLE

A data type declares a cast from a type no contract source can write, so the cast could never be exercised. Raised while checking the assembled data types. Payload: `dataType`, `source`, `contributedBy`. Also raised when a type constructor has a value argument (`{ kind: 'value', dataType }`) whose data type no contract source can write, itself or through a type it casts from, so no schema could give the argument. Payload: `dataType`, `contributedBy`.

### CONTRACT.DATA_TYPE_UNREGISTERED

Something names a data type that no component in the stack registers: a codec's `dataType`, an authoring entry's key, a type its number classifier returns, a type a cast takes values of, or the data type of a type constructor's value argument. Raised while checking the assembled data types. Payload: `dataType`, `contributedBy`. Also raised while a SQL contract is authored, when a column's codec is registered but the data type it represents is not, so the column's database type cannot be named. List the pack that declares the data type, usually the pack that provides the codec. Payload (meta): `codecId`, `dataType`. Also raised when a PostgreSQL adapter is built with a codec whose data type is not passed beside it (`createPostgresAdapter` without the codec's type in `dataTypes`, or an extension that contributes codecs without their `dataTypes`), because a parameter of that codec could not be cast. Payload (meta): `codecId`, `dataType`.

### CONTRACT.DATA_TYPE_WRITTEN_FORM_DUPLICATE

Two authoring entries claim the same written form — the same literal tag, or the same plain string, boolean, or number syntax — so a written default would have two readers. Raised while checking the assembled data types. Payload: `claim`, `key`, `contributedBy`, `owner`, `ownerContributedBy`.

### CONTRACT.DEFAULT_INVALID

A field's default declaration is invalid: `defaultSql` is used on an enum field. The SQL TypeScript builder accepts a database `default` together with `executionDefaults`, and `executionDefaults` on a nullable field. The Mongo TypeScript builder accepts `executionDefaults` on a nullable field too, and refuses them on a list (`Field "<Model>.<field>" generates a value on write, so it cannot be a list; remove .many().`, `reason: 'many-with-executionDefaults'`); it also refuses `.many()` on such a field in the type. Raised while authoring/building a SQL contract. Payload: `modelName`, `fieldName`, `reason`. The SQL TypeScript builder raises it for `.default(...)` on a field that already has a default, set by an earlier `.default(...)` or `.defaultSql(...)` or an alias constant (`.default() is called on a field that already has a default. Set the default once, and do not combine .default() with an alias constant that sets one.`, `reason: 'default-set-twice'`, raised when the builder is called). The SQL and Mongo TypeScript builders raise it for `.onCreate(...)` and `.onUpdate(...)`: when a phase is set twice, by two calls or by a call and a type alias or alias constant that sets the phase (`reason: 'generator-phase-set-twice'`, meta `phase`, raised when the builder is called); when the `gen` call's function does not fill the field's codec or refuses the column (`reason: 'generator-not-applicable'`); when no pack in the contract declares the function (`reason: 'generator-unknown'`); and, in the SQL builder, when the field is a list, as in `.many().onCreate(gen.uuid())` (`Field "<Model>.<field>" is a list and cannot use .onCreate(uuid()). Lists have no per-element generated values; remove .onCreate(...).`, `reason: 'generator-on-list'`). The last three are raised when the contract is built, with meta `modelName`, `fieldName`, `codecId` and `function`. The SQL TypeScript builder also raises it when the column's codec refuses the value passed to `.default(value)`, because the value is not the codec's input type (for example a string on `field.column(type.DateTime())`, whose codec takes a `Temporal.Instant`); TypeScript reports the same mistake as a type error when the field comes from the `defineContract` factory; the message carries the codec's own message, the original error is the `cause`, and the meta is `modelName`, `fieldName`, `codecId`, `reason: 'codec-refused-default'` and, for a list column, the 1-based `elementPosition`. It raises it too when the build has a codec lookup and no pack in the contract declares the column's codec, so the default cannot be checked (`reason: 'codec-not-found'`; list the pack that owns the codec in `extensions`), and when a list field has a default that is not an array (`reason: 'list-default-not-array'`). The Mongo TypeScript builder raises it for execution defaults it cannot key to one collection field: on a variant model's field (`reason: 'executionDefaults-on-variant'`; declare the field on the base model, whose defaults apply to every variant), or with different phases on two models stored in the same collection (`reason: 'executionDefaults-conflict'`; identical ones are merged). The PSL interpreter reports the same cases as `PSL_GENERATOR_ON_VARIANT_FIELD` and `PSL_GENERATOR_CONFLICT`. Also raised by the Postgres adapter's DDL renderer when a hand-authored `col(...)` pairs an `autoincrement()` default with a type that isn't `SERIAL`/`BIGSERIAL`/`SMALLSERIAL` (or their `SERIAL4`/`SERIAL8`/`SERIAL2` aliases). Meta in that case: `typeText`. PostgreSQL `setDefault` in a `migration.ts` raises it for a column with no default (`reason: 'set-default-without-default'`), and for an `autoincrement()` default on a column whose type is not smallint, integer or bigint (`int2`, `int4`, `int8`), such as a `serial`, `text` or list column (`reason: 'set-default-autoincrement'`). Meta in both cases: `table`, `column`, `reason`. On an integer column, `setDefault` with `fn('autoincrement()')` creates the sequence a SERIAL column of that width gets (`{table}_{column}_seq`), or reuses it and changes its type to the column's current width, sets the column's default to it, attaches it to the column, and starts it past the column's largest value; its precheck fails with `MIGRATION.PRECHECK_FAILED` when another relation already has the sequence's name, unless it is the sequence the column already owns. The planner writes the same `setDefault` when the contract gives an existing column an `autoincrement()` default, so it reports the same refusal. Also raised by the Postgres and SQLite DDL renderers for a literal default the column's codec refuses, which a `contract.json` an earlier version emitted, or a `migration.ts` it planned, can hold, and so can either file after a hand edit: `Column "<table>"."<column>" has a default its codec <codecId> refuses: <codec message>`, with meta `table`, `column`, `codecId`, `value` and `reason: 'codec-refused-default'`. Every DDL statement that writes a default reads it this way: a new table or column, a changed default, and on SQLite a rebuilt table. The Postgres renderer reads each element of a list default the same way; for a refused element the message says `has a default (element <n>)`, `value` is the element and the meta adds its 1-based `elementPosition`. `db init`, `db update` and `migration plan` report it as it is. For a `contract.json`, emit the contract again with the current version, and correct the default in the contract source if emit refuses it; for a `migration.ts`, correct the default in that file. Also raised by the SQLite adapter's DDL renderer for a `NaN` default on a column with no codec, which SQLite would store as NULL: `Column "<table>"."<column>" has a NaN default, which SQLite stores as NULL`, with meta `table`, `column`, `value: 'NaN'` and `reason: 'nan-default'`. Both DDL renderers raise it for an invalid `Date` default on a column with no codec: `Column "<table>"."<column>" has an invalid Date default`, with meta `table`, `column` and `reason: 'invalid-date-default'`. A NaN or infinite float default renders as `'NaN'::float8`, `'Infinity'::float8` or `'-Infinity'::float8` (the column's own float type) on Postgres, and an infinity as `9e999` or `-9e999` on SQLite, which introspection reads back as the infinity, so the applied default verifies. Also raised by the SQL TypeScript builder's `.default()` when it is given a `sql` value whose text is exactly `now()` or `autoincrement()` (`` Write .default(now()) instead of sql`now()`; now() is a Prisma default function, not raw SQL. ``; meta: `reason: 'reserved-function'`, `expression`), or whose text fails the SQL body check (`Default SQL must not contain semicolons, SQL comment tokens, dollar-quoting, or subqueries.`; meta: `reason: 'unsafe-sql'`, `expression`), and by the Postgres and SQLite DDL renderers when a function default fails that same check (`Unsafe default expression in contract: "<expression>"`; meta: `expression`), and by `addColumnWithTemporaryDefault` in a Postgres `migration.ts` when its `temporaryDefault` fails that check (`addColumnWithTemporaryDefault({ schema: "<schema>", table: "<table>", column: "<column>" }): temporaryDefault "<value>" is not a value: <reason>`, without `schema` when the table has no named schema; meta: `expression`, `where`). Both migration planners also raise it for a literal default in the contract that its column's data type refuses, such as a date without an offset on a `timestamptz` column, which a contract emitted by an earlier version can hold; the message carries the type's refusal and says to re-emit the contract (meta: `reason: 'default-not-canonical'`, `column`). The SQL TypeScript builder raises it for a literal default on a column whose data type has no literal values, such as a raw column's: `Field "<Model>.<field>" has a literal default.` followed by the data type's message, with the cause `CONTRACT.LITERAL_VALUES_ABSENT` (meta: `reason: 'no-literal-values'`). `db update`, `db init` and `migration plan` report the planner's error under this code. Schema verification reports the same refusal as the explanation of the default's mismatch, or of its absence when the database has no default.

### CONTRACT.ENTITY_KIND_INVALID

An entity attached to the contract declares a framework-wire namespace entry kind (`table` or `valueSet`), which only the framework itself may mint. Raised while building a SQL contract with pack-contributed entities. Payload: `entityKind`, `namespaceId`.

### CONTRACT.ENTITY_KIND_UNKNOWN

An entity handle passed to the contract has an `entityKind` that no composed pack registers, so the builder cannot lower it, or contract entries carry a kind no composed pack recognizes when the framework hydrates entities from an emitted contract. Raised during SQL contract lowering and entity hydration. Payload: `entityKind`.

### CONTRACT.ENUM_CODEC_NOT_IN_PACK_STACK

An enum declares a `codecId` that no family, target, or extension pack in the contract provides, so its member values cannot be encoded. Raised by the SQL and Mongo TypeScript `defineContract` when the codec lookup built from the contract's packs has no codec for the id, and by the SQL PSL reader, which builds through the same SQL contract build, when its enum factory does not check the lookup. Payload: `codecId`. In PSL, the built-in enum factory of either family reports a missing or unknown codec first, as `PSL_EXTENSION_INVALID_VALUE` at the enum with its own `@@type` messages. The Mongo PSL and Prisma 6 readers report a codec missing from the lookup, when an enum factory does not check the lookup, as `PSL_EXTENSION_INVALID_VALUE` at the enum: `enum "<name>" uses codec "<codecId>", which no pack in the contract provides`.

### CONTRACT.ENUM_INVALID

An enum declaration is malformed. Raised while authoring a contract. Payload: `enumName` and `reason`, plus `member` (a member's name; for `nativeEnum()`'s `duplicate member value`, the repeated value), `members` (both names), `codecId` (the enum's codec, for `codec-refused-member` and `codec-not-for-enums`) or the declaration key (`declarationKey` in the SQL builder, `declaredKey` in the Mongo builder), depending on the case. The cases, by `reason`:

- `enumType()` itself:
  - `no-members`: the enum has no members;
  - `duplicate-member-name`: two members have the same name;
  - `duplicate-member-value`: two members have the same value by SameValueZero, the equality the handle's `has`, `nameOf` and `ordinalOf` use; `members` names both. Values that differ there, such as `1` and `'1'` or two distinct objects, are compared again by the contract build, as their codec stores them.
- The SQL contract builder (`defineContract` from the Postgres and SQLite packages):
  - `key-name-mismatch`: the key in `defineContract({ enums })` differs from the `enumType` name;
  - `codec-not-for-enums`: an enum cannot use the enum's codec. A codec without the `equality` trait is refused, because no value can be compared with a member, and so is a codec whose descriptor gives its own reason in `enumRefusal`. On Postgres these are `pg/bytea@1`, whose stored base64 text Postgres would read as the bytes of that text (no enum can use a bytea codec; use a text enum); `pg/tsquery@1`, whose text Postgres normalises, printing `a & b` as `'a' & 'b'` (use a text enum); `pg/json@1`, whose type has no equality operator, so no CHECK can compare a value with the members (use a text enum); `pg/jsonb@1`, and `arktype/json@1`, which stores `jsonb`, because a CHECK lists a string member as SQL text, which PostgreSQL reads as the JSON text of a document, and a number member as a number, which PostgreSQL cannot compare with `jsonb` (use a text enum); `pg/enum@1`, which types the column of a native enum, whose values the database enforces with an enum type of its own (declare a native enum: `native_enum` in PSL, or `nativeEnum` in TypeScript); `pg/vector@1`, whose members are arrays of numbers, which no CHECK can list (use a text enum); and `pg/geometry@1`, which is not supported yet, because no test proves that a shape reads back as its member (use a text enum that names each shape). The message is `enumType("<name>"): an enum cannot use the codec <codecId>. <reason>`, and the reason ends with what to use instead. A PSL enum block typed by such a codec, in either family, is reported as `PSL_EXTENSION_INVALID_VALUE` at its `@@type`, with the same reason;
  - `codec-refused-member`: the enum's codec refuses a member's value, either when writing it or when reading back what it wrote, such as a `pg/char@1` member longer than one character, since the enum's column is `character`. The message is `enumType("<name>") member "<member>" has a value its codec <codecId> refuses: <codec message>`; give the member a value the codec takes;
  - `member-not-stored-as-written`: the column's codec reads a member back as a different value from the one written. The check compares through the stored value: the codec's `toDataTypeValue` gives the member's stored value, and `fromDataTypeValue` of that value must equal the member. An upper-case or braced uuid is refused because `pg/uuid@1` stores lower case, a `pg/numeric@1` member with a leading zero or a minus sign on zero because Postgres prints `01.5` as `1.5` and `-0` as `0`, and a `pg/inet@1` member such as `10.0.0.1/32` or `::FFFF:10.0.0.1` because Postgres prints `10.0.0.1` and `::ffff:10.0.0.1`. A numeric enum's CHECK constraint, on a scalar or a list column, compares values as numbers, so the column also takes a value equal to a member but written with another scale, such as `0.50` for the member `0.5`, which reads back as `0.50` and which `db.enums` finds as the member `0.5`, because the enum compares values by its data type's equality. Only members with a literal type (strings, numbers, booleans, bigints, and arrays and plain objects of them) are checked, and the check is only as exact as the stored value: where it is not the text Postgres returns, a member Postgres would print differently is accepted;
  - `duplicate-member-value`: two members that the codec stores as the same value; `members` names both. Stored values are compared by their JSON form, so two objects with the same entries in a different order are the same value. The message is `enumType("<name>"): members "<first>" and "<second>" both store <stored value>. Member values must be unique as their codec stores them.` For a data type whose equal values have more than one stored form (`pg/numeric`, `pg/interval`, `mongo/decimal128`), stored values are compared by the type's equality instead, and two members stored in different forms of one value are refused with both forms named: `enumType("<name>"): members "<first>" and "<second>" store "0.5" and "0.50", which the database holds equal. Member values must be unique as their data type compares them.` The PSL readers report the same two cases as `PSL_ENUM_DUPLICATE_MEMBER_VALUE`, at the later member: `enum "<name>": members "<first>" and "<second>" both store <stored value>`, or `enum "<name>": members "<first>" and "<second>" store "P1D" and "PT24H", which the database holds equal`;
  - `unsupported-member-value`: a member of an enum used by a column's membership CHECK encodes to something other than a string or a finite number. Members that encode to both, such as `1.5` and `"NaN"` on a float enum, are allowed, because the CHECK compares them in the column's type.
- The Mongo contract builder: `declaration-key-mismatch`, the key in `defineContract({ enums })` differs from the `enumType` name; and `codec-not-for-enums`, `codec-refused-member`, `member-not-stored-as-written` and `duplicate-member-value`, as for the SQL contract builder, with `the field stores` in place of `the column stores`; and two cases for the collection validator, which lists an enum's members in their stored form: `not-listable-by-validator`, the enum's codec stores a BSON type a validator cannot list, such as `long` (`enumType("<name>") codec "<codecId>" stores BSON type long, which a collection validator cannot list as an enum value. …`), and `member-not-listable-by-validator`, a member's stored form is not a value of that BSON type, such as a string member of a double enum (meta adds `member`). The Mongo PSL interpreter reports both as `PSL_EXTENSION_INVALID_VALUE`, at the enum's `@@type` or member, with the same reasons. The SQL and Mongo builders run the same checks, in the same order. The Mongo PSL and Prisma 6 readers run them too, on the members the enum factory read, and report each at the member: `codec-refused-member` and `member-not-stored-as-written` as `PSL_EXTENSION_INVALID_VALUE` (`enum "<name>" member "<member>" is written <value>, but its codec stores <stored>. Write the member as <value to write>.`), and `duplicate-member-value` as `PSL_ENUM_DUPLICATE_MEMBER_VALUE`. The built-in enum factory reads each member through the codec before that, so with it a codec whose `toDataTypeValue` throws on a value its own `fromDataTypeValue` produced is a codec bug: its error propagates and is not reported as `codec-refused-member`.
- `nativeEnum()` from the Postgres package: `empty name` and `empty type name` (a blank enum name or Postgres type name), `zero members`, and `duplicate member value` (two members with the same label).

### CONTRACT.ENUM_UNKNOWN

A Mongo field references an enum that is not declared in `defineContract({ enums })`. Raised by the Mongo contract builder. Payload: `modelName`, `fieldName`, `enumName`. A field of a value object is checked too; its payload names `valueObjectName` instead of `modelName`.

### CONTRACT.EXPORT_INVALID

The TS contract module's export is not a plain JSON-serializable contract object: a non-object export, circular references, getters, or function-valued properties. Raised by the CLI while loading a TypeScript contract source. Payload: `path`, `reason`, `key`.

### CONTRACT.FIELD_HELPER_UNKNOWN

A TypeScript contract read a field preset Prisma 8 removed from the SQL or MongoDB `field` helpers, such as `field.text` or `field.id.uuidv4String`. TypeScript reports the missing property; this error reaches a JavaScript caller, or a contract that `prisma contract emit` loads before it is type-checked. The message gives the preset's rewrite: `field.id.uuidv4String was a field preset, and Prisma 8 removed field presets. Write field.column(type.UuidString()).id().onCreate(gen.uuid()). The upgrade guide "Field presets are removed" lists every rewrite.` A SQL preset whose rewrite writes a type the target does not have with the preset's codec, such as `field.json` on SQLite, gets a message naming the forms that replace presets instead: `field.column(type.X(...))` with `.id()`, `.onCreate(gen.fn())` and `.onUpdate(gen.fn())`, or a type alias such as `field.column(type.temporal.CreatedAt())`. Raised when the property is read. A read of any other name that `field` does not have gives `undefined`, as on a plain object. Payload: `helper`, the property path read, such as `field.id.uuidv4String`.

### CONTRACT.FIELD_UNKNOWN

An index or column mapping references a field the model does not declare (unknown field in the contract definition, or a Mongo model index over an undeclared field). Raised while lowering/building the contract. Payload: `modelName`, `fieldName`, `indexSignature`. The Mongo contract builder also raises it for a discriminator that names a field its model does not declare (`reason: 'discriminator-field-unknown'`).

### CONTRACT.FOREIGN_KEY_INVALID

A foreign key's target refs are empty or inconsistent: no target ref given, refs point at different models, or compound refs disagree on `spaceId`, `namespaceId`, or `tableName`. Raised by the SQL contract DSL while declaring the FK. Payload: `mismatch`, `first`, `second`.

### CONTRACT.IDENTITY_INVALID

A model's identity is wrong: multiple fields marked `.id()`, identity declared both inline and in `.attributes(...)`, an empty identity, a model with non-owning relations but no id to anchor them, or an M:N target with no primary/unique key to derive junction columns from. Raised while lowering/building a SQL contract. Payload: `modelName`, `reason`.

### CONTRACT.IDENTIFIER_INVALID

A SQL identifier or literal fails escaping-safety checks while rendering DDL/SQL: an empty identifier, a null byte in an identifier or string literal, or a native enum label exceeding PostgreSQL's 63-byte limit. Raised by the Postgres and SQLite SQL utilities (formerly the `SqlEscapeError` class, removed at 0.17). Payload: `value`, `context`.

### CONTRACT.INDEX_INVALID

A Mongo variant model declares an index that conflicts with the discriminator scope of its variant, or a SQL index option value is not a string, finite number, or boolean. Raised by the Mongo contract builder and the Postgres index DDL renderer. Payload: `variantName`, `indexLabel`, `reason`, `key`. The Mongo contract builder also refuses, for every source, an index whose shape MongoDB refuses (payload `modelName`, `indexSignature`, `reason`): a unique wildcard index (`unique-wildcard`), a wildcard with a hashed, 2d or 2dsphere key (`wildcard-with-type`), a hashed index on several fields (`hashed-several-fields`), a TTL wildcard index (`ttl-with-wildcard`), a wildcard projection without a wildcard key (`projection-without-wildcard`), a collation without a locale (`collation-without-locale`), and a second text index in one collection (`second-text-index`). Mongo PSL reports each as `PSL_INVALID_INDEX` at the index.

The Postgres `fullTextIndex` helper also raises it when its fields are not one to four non-empty weight groups naming each field once, or when a field is not stored through a textual codec (payload for both: `helper`, and `fields`, the weight groups as field names). `renderFullTextIndexDocument` raises it for a definition whose weight groups break the same rules (payload: `weightGroups`). Building or reading a Postgres contract raises it for an index of type `fullText` that is unique, whose options are not one to four weight groups and a language, or whose `columns` are not exactly the fields of its weight groups in order (payload: `index`, `columns`, `options`). Reading a Postgres contract also raises it for a foreign key whose `index` names a `fullText` index (payload: `index`, `columns`, the foreign key's columns). Building any SQL contract raises it for an index whose type requires column traits (`columnTraits` on its registration) over a column whose codec lacks one, such as a `fullText` index over a column that is not text (payload: `indexType`, `index`, `column`, `codecId`, `missingTraits`).

### CONTRACT.INFER_COLUMN_TYPE_UNCLAIMED

`contract infer` found columns whose type Prisma 8 cannot write with the configured stack, so it prints no schema. A column type can be written only when a data type that the target or an extension pack declares claims it, and that data type has a type constructor marked to be written by infer. `tsquery`, for example, has a data type but no such constructor. The message starts `contract infer: Prisma 8 cannot write these column types with the configured stack:` and lists every such column as `<schema>.<table>.<column>: <type as the database reports it>`, with `[]` for a list. Some forms stay unclaimed even with their pack configured: a `vector` column with no dimension (`pgvector`), and `geometry(Point,<srid>)` and the other geometry subtypes (`postgis`). Some types have no data type at all: `interval` with fields, such as `interval year to month`, `"char"`, domains, and `hstore`. Fix path: no configured pack has a type for these columns. If a type comes from a database extension that has a Prisma 8 pack (for example `pgvector` or `postgis`), add the pack to `extensions` in `prisma.config.ts`. Otherwise, to keep such a column, write the schema by hand and declare its field as ``Raw(sql`<type>`)`` with the type as listed (ADR 273), or change the column's type or remove the column from the database. Payload: `columns`.

### CONTRACT.INFER_UNSUPPORTED

`contract infer` is not available: either the configured family does not implement the `PslContractInferCapable` capability (no meta at that site), or the family supports inference but the database shape cannot be expressed yet: duplicate table names across schemas, a column typed by a native enum that an extension pack space already describes in another schema, or native enum adoption with content spanning multiple schemas. Meta at the shape sites: `tableName`, `columnName`, `schemas`.

### CONTRACT.INTROSPECTION_UNSUPPORTED

Introspection read an unrecognized or malformed database shape: an unknown referential action rule, or a malformed index reloption entry. Raised by the Postgres and SQLite control adapters. Payload: `rule`, `entry`, `indexName`.

### CONTRACT.INVALID_JSON_LITERAL

The text of a JSON default is not a JSON document, or holds a number outside the range a JSON number holds (`JSON.parse` reads such a numeral as `Infinity`, which `JSON.stringify` writes back as `null`). Raised while reading the text of a JSON default. Contract sources report it to the author as the PSL diagnostic `PSL_INVALID_LITERAL`. Payload: `why`, `fix`.

### CONTRACT.LITERAL_VALUES_ABSENT

A literal default names a value of a data type that has no literal values: a raw column, declared with ``Raw(sql`...`)`` or ``rawColumn(sql`...`)`` (ADR 273), whose values Prisma does not interpret. The data type's reader refuses every value, so the refusal is the same wherever the default comes from. The TypeScript builder raises `CONTRACT.DEFAULT_INVALID` with this error as its cause, naming the field; loading a hand-written `contract.json` raises `CONTRACT.VALIDATION_FAILED`, naming the table and column; a PSL schema refuses the literal earlier, with `PSL_VALUE_TYPE_INCOMPATIBLE` (``Expected sql`...` ``). Write the default as a SQL expression: ``@default(sql`...`)`` in a schema or ``.default(sql`...`)`` in TypeScript.

### CONTRACT.MARKER_MISMATCH

The contract hash does not match the marker (signature) stored in the database. `db verify` reports it as an `error` diagnostic on a completed run that exits `4`; the SQL runtime reports it as a warning during startup marker verification. Fix path: migrate the database or re-sign if the divergence is intentional. Payload: `expected`, `actual`.

### CONTRACT.MARKER_MISSING

No contract marker (database signature) is found in the database at all. `db verify` reports it as an `error` diagnostic on a completed run that exits `4`; the runtime reports it as a warning during startup marker verification. Fix path: `prisma db sign`. Payload: none notable.

### CONTRACT.MARKER_READ_FAILED

A driver-level failure occurred while reading the contract marker table: connectivity, permissions, or locking problems rather than bad marker content. Raised whenever a CLI/control operation reads the marker, and by the runtime when its first query on a database connection reads the marker (with the default `verifyMarker`) and that read fails; the runtime retries the read on its next query. An error whose code is in the `DRIVER` namespace, such as `DRIVER.NOT_CONNECTED`, is raised as itself, not wrapped in this code. Payload: `space`.

### CONTRACT.MARKER_REQUIRED

A command that requires a pre-signed database (marker present) as a precondition found none. It is a precondition failure at exit `2`. Fix path: run `prisma db init` or `prisma db sign` first. Payload: none notable.

### CONTRACT.MARKER_ROW_CORRUPT

The marker row exists but its column values fail schema validation: the row is corrupt or written by an incompatible version. Fix path: delete the row and re-sign with `prisma db sign`. Payload: `space`.

### CONTRACT.MODEL_BASE_MISSING

A variant model names a `base` that is not a model in the contract, so its type in `contract.d.ts` cannot include the base's fields. Raised while emitting `contract.d.ts`. Payload: `variant`, `base`.

### CONTRACT.MODEL_RELATION_TARGET_MISSING

A same-space relation points at a model the contract does not declare. Raised while emitting the `Models` namespace in `contract.d.ts`; only cross-space relations may reference models outside the contract. Payload: `owner`, `relationName`, `target` (`namespaceId`, `modelName`).

### CONTRACT.MODEL_TOKEN_INVALID

A model token is misused in the TS authoring DSL: an unnamed token is used in `.ref(...)` or as a relation target (tokens need `model("Name", ...)`), or a token is assigned under a `models` key that does not match its name. Payload: `tokenModelName`, `assignedKey`.

### CONTRACT.MODEL_TYPE_NAME_COLLISION

Two models produce the same emitted type name in the `Models` namespace of `contract.d.ts`, formed as `<namespace>_<Model>`, for example a `public_User` model beside a `public` namespace holding `User`, or a model named `AnyTask` beside a polymorphic base `Task`. Raised while emitting `contract.d.ts`. Payload: `memberName`, `sources`.

### CONTRACT.MODEL_TYPE_NAME_INVALID

An emitted model type name, formed as `<namespace>_<Model>`, is not a TypeScript identifier, for example because the namespace contains a hyphen. Raised while emitting `contract.d.ts`. Payload: `memberName`, `source`.

### CONTRACT.MODEL_UNKNOWN

A relation, foreign key, junction (`through`) reference, or context declaration names a model that is not declared in the contract. Raised while lowering/building a SQL contract. Payload: `sourceModel` (or `sourceTable` and `sourceNamespaceId` when a table node owns the foreign key), `relationName`, `targetModel`.

### CONTRACT.MODEL_VARIANT_MISSING

A polymorphic base names a variant that is not a model in the contract, so the `Any<Base>` union in `contract.d.ts` cannot be formed. Raised while emitting `contract.d.ts`. Payload: `base`, `variant`.

### CONTRACT.MODULE_EXPORT_MISSING

The contract module at the configured path loads but exposes neither a `default` nor a `contract` export, so the CLI cannot obtain the contract from it. Raised when resolving a TS contract from config (SQL and Mongo). Payload: `path`.

### CONTRACT.NAME_DUPLICATE

Two declarations claim the same name: duplicate namespace entries, model names, value objects, relations, tables (two models mapping to one table, two table nodes for one table, or duplicate table in a namespace), column mappings (two fields to one column, a field and a table node's column node for one column, or two column nodes for one column), stored names (two fields of one MongoDB model stored under one name with `.mongo({ field })`: `Model "<Model>" stores both "<a>" and "<b>" as "<name>".`, `kind: 'field'`), indexes, value-sets (enum and pack entity minting the same value-set), or pack entities of the same kind and name in one namespace. Raised while authoring/building a contract. Payload: `kind`, `name`, `namespaceId`, `tableName` (for a column), `first`, `second`. A MongoDB variant field stored under a name a field of its base is stored under, the discriminator included, is refused too (`reason: 'stored-name-shared-with-base'`, with `first` the base's field and `second` the variant's): a variant's documents hold its base's fields, so the two would overwrite each other. Mongo PSL reports it as `PSL_DUPLICATE_STORED_NAME`.

### CONTRACT.NAMESPACE_INVALID

A namespace name is empty, whitespace-only, or a reserved sentinel (`__unbound__`, `__unspecified__`, or Postgres's reserved `unbound`), either in the declared `namespaces` list or on a model. Raised by the SQL contract builder. Payload: `namespace`, `reason`, `modelKey`.

### CONTRACT.NAMESPACE_UNKNOWN

A model references a namespace that is not in the contract's declared `namespaces` list. Raised by the SQL contract builder. Payload: `modelKey`, `namespace`, `declared`.

### CONTRACT.NAMESPACE_UNSUPPORTED

Namespaces are declared (contract-level list or a model-level `namespace`) on a target that has no schema/namespace concept, i.e. SQLite. Raised by the SQL contract builder. Payload: `namespaces`, `modelKey`, `targetId`.

### CONTRACT.PACK_CONTRIBUTION_INVALID

A composed pack's contribution is malformed or collides with another contribution; this is the extension-author-facing bucket. Covers: entity types colliding with reserved helper keys, duplicate entity kinds or index-type registrations, a registered entity kind with no `lowerEntityHandles` lowering, an invalid `indexTypes` shape, entries-slot collisions between a model attribute and a block entry kind, a model attribute that lowers to a malformed index, bad authoring-helper paths, a codec registered with an entity-ref arg but no `columnFromEntity` hook, and print-time contribution mismatches (a block keyword with no PSL block descriptor, or a descriptor whose discriminator disagrees with the block's kind). Raised during contract authoring/lowering and PSL printing.

A contributed type alias (`kind: 'typeAlias'`, such as `temporal.CreatedAt`) is refused when the stack is assembled, by the control stack and by the TypeScript builders, so PSL and TypeScript refuse the same packs. Its type params may not reference an argument, because a type alias takes none: `Invalid authoring type alias "<path>" contributed by descriptor "<id>". output.type.typeParams.<key> references an argument, but a type alias takes none. Write the value itself.` Each generator call must resolve for the alias's codec: `Type alias "<path>" calls now() on create, which does not apply to its codec "<codecId>".`, `…, which its codec "<codecId>" refuses: <reason>`, or `…, but no component declares the generator function "<name>".` Payload: `packId`, `contribution`, `reason`, `keyword`, `paramName`, `codecId`.

The Mongo `defineContract` builder raises it for a model field, a value object field or an enum whose codec represents a data type that is not a MongoDB data type (`reason: 'data-type-not-mongo'`): the pack declared the data type without `mongoDataType`, so its BSON type is unknown and the contract cannot describe the field. The Mongo PSL interpreter reports the same case at the field as `PSL_UNSUPPORTED_FIELD_TYPE`. Payload (meta): `modelName`, `valueObjectName` or `enumName`, `fieldName` for a field, `codecId`, `dataType`, `reason`.

An extension pack's index type whose `accessMethod` differs from its type name is refused with this code when the registry is assembled, at the same points. Only the target converts such a type into an index of its access method, so an extension pack's index type must be an access method itself. Message: `Index type "<type>" registered by extension pack "<packId>" declares the access method "<accessMethod>", but an extension pack's index type must be an access method itself.` `fix`: register the access method under its own name, or leave `accessMethod` out. Payload: `indexType`, `accessMethod`, and `packId` when the pack is known.

The generator functions of a stack (`@onCreate(fn())`, `@onUpdate(fn())` and the TypeScript builder's `gen` calls) are refused with this code when they are assembled, naming the components involved: two components declare a signature for one function (`Generator function "<name>" is declared by both "<component>" and "<component>".`); a component binds a function no component declares (`"<component>" binds generator function "<name>", which no component declares.`); two bindings cover one function and one codec (`Generator function "<name>" is bound to codec "<codecId>" by both "<component>" and "<component>".`); two functions write the same generator for one codec, so `contract print` could not choose one (`Generator "<generatorId>" on codec "<codecId>" is written by both function "<name>" from "<component>" and function "<name>" from "<component>".`); a binding produces a generator no generator descriptor registers (`Generator function "<name>" from "<component>" produces generator "<generatorId>", which no generator descriptor in the stack registers.`); a signature declares a named parameter, which a `gen` call cannot pass (`Generator function "<name>" from "<component>" declares the named parameter "<parameter>". …`); or two components register one generator id (`Generator "<generatorId>" is registered by both "<component>" and "<component>". Register each generator once, in the component that defines it.`). The SQL family registers the identifier generators, so a SQL target, adapter or extension that also registers `uuidv4`, `uuidv7`, `cuid2`, `ulid`, `nanoid` or `ksuid` gets the last one; remove its registration. The control stack and the TypeScript builders run the same checks.

A type constructor whose argument is not a value argument, such as `{ kind: 'number', name: 'size' }`, is refused with this code when the stack's data types are assembled, by the control stack and the TypeScript builder alike. Message: `Argument "<name>" of type constructor "<path>" contributed by "<component>" is an argument of kind "<kind>", but a type constructor's argument is a value of a data type. Declare it as { kind: 'value', dataType: ... }, naming the data type its value belongs to.` An argument with no `name` is named by its position, `Argument #<n>`, counting from 1. Payload: `packId`, `contribution` (the constructor's path), `reason: 'type-constructor-argument-not-a-value'`.

A component whose `authoring` has a `field` key is refused with this code by the control stack and the TypeScript builders. The key held field presets, which Prisma 8 removed: `Component "<id>" contributes authoring.field, which Prisma 8 removed with field presets. Contribute a type alias (kind: 'typeAlias') or a type constructor in authoring.type.` Move each preset into `authoring.type`: a preset that stored a column and generated values becomes a type alias, as the targets' `temporal.CreatedAt` is, and one that took arguments becomes a type constructor.

### CONTRACT.PACK_FAMILY_MISMATCH

A pack passed to `defineContract` belongs to the wrong family: a non-SQL pack in a SQL contract (or non-Mongo in a Mongo contract), a target pack whose family disagrees with the contract's, or an extension pack from another family. Payload: `packId`, `packFamilyId`, `contractFamilyId`.

### CONTRACT.PACK_MISSING

A cross-space reference names a contract space that is not declared in the contract's `extensions`, so the space cannot be resolved. Raised during SQL contract lowering. Payload: `spaceId`, `context`.

### CONTRACT.PACK_REF_INVALID

Something other than an extension pack reference was passed in `defineContract`'s `extensions` list (e.g. a family or target pack). Payload: `packId`, `kind`.

### CONTRACT.PACK_TARGET_MISMATCH

An extension pack targets a different database target than the contract does (e.g. a Postgres-only extension pack in a SQLite contract). Raised by the SQL and Mongo contract builders. Payload: `packId`, `packTargetId`, `contractTargetId`.

### CONTRACT.POLICY_INVALID

An RLS policy declaration is invalid: it targets a model in another contract space, its prefix exceeds the length limit or is declared twice in one namespace, or it targets a table that is not RLS-enabled or not present in the namespace. Raised by the Postgres `defineContract` builder and while deriving the Postgres schema tree from the contract. Payload: `prefix`/`policyName`, `tableName`, `namespaceId`, `reason`.

### CONTRACT.RELATION_INVALID

A relation's shape is wrong: `.sql(...)` on a non-belongsTo relation, mismatched field counts between the two sides, an N:M relation without `through` metadata, a relation target referencing a field of another model, or a join column that no field of its model maps (`reason: 'join-column-not-a-field'`; the target side of an N:M relation names junction columns and is exempt). The Mongo builder also refuses an embed relation to a model with variants (`reason: 'embedded-model-has-variants'`), because the ORM reads and writes only the base fields of an embedded model. Raised while authoring/building a contract (SQL and Mongo). Payload: `modelName`, `relationName`, `reason`, and `column` for an unmapped join column.

### CONTRACT.ROLE_INVALID

A role entity is declared more than once in the entities list, or a role name is not a plain SQL identifier. Raised by the Postgres contract builder and RLS DDL rendering. Payload: `role`, `reason`.

### CONTRACT.SCHEMA_VERIFICATION_FAILED

Schema verification found that the live database schema does not satisfy the contract: missing/extra/mismatched tables, columns, or other elements. `db verify` and `db sign` both report it as an `error` diagnostic on a completed run that exits `4`: for `db verify` that is the drift verdict, and for `db sign` it is the reason that space's signature was not written. `db verify` and `db sign` raise one such diagnostic per contract space whose schema failed, and `db verify --strict` raises it once when the database holds elements no contract declares (the result's `unclaimed` list names them). It is also the code a failing verify result carries when nothing more specific applies. Fix path: `prisma db update` or adjust the contract; for unclaimed elements, declare them in a contract or drop them from the database. Payload: `space` (the contract space), `schemaIssues` (the schema diff issues, the same shape `MIGRATION.SCHEMA_VERIFY_FAILED` carries; the `why` names them). The strict-mode unclaimed diagnostic carries no `space` and an empty `schemaIssues` list; the names are in the result's `unclaimed` list.

### CONTRACT.SOURCE_IMPORT_DISALLOWED

The TypeScript contract module imports something outside the contract-source import allowlist; contract sources must stay pure so they can be bundled and evaluated deterministically. Raised by the CLI while loading a TS contract source. Payload: `allowlist`, `disallowed`.

### CONTRACT.SOURCE_DIAGNOSTIC

One finding a contract source reported with a code that is not yet dotted, such as the Prisma 8 PSL interpreter's `PSL_UNSUPPORTED_FIELD_TYPE` or a parser's `PSL_PARSE_ERROR`. This is its only producer case: it exists until those codes convert to dotted ones, and a source code that is already dotted, such as `PSL.PRISMA7_VIEW_UNSUPPORTED`, is reported under its own code instead. Never raised on its own; carried, one per such source diagnostic, in the `diagnostics` list of a `CONTRACT.SOURCE_LOAD_FAILED` error during `contract emit` or `contract print`, printed under it in the terminal and serialized as the envelope's `diagnostics` in JSON. `summary` is `<file>:<line>:<column> <source code>: <message>` (the location is omitted when the source gave none; a file the source names by its absolute path is shown relative to the working directory). `where` carries `path` and `line`. Payload: `code` (the source's own diagnostic code). A contract source's warnings, such as `PSL_DEPRECATED_SCALAR_NAME`, are reported the same way with severity `warn`, in the `diagnostics` of a successful `contract emit` or `contract print`; their `meta` also carries the source's `span`, whose `start` gives the line and column. Fix: edit the schema at each location the findings name, then run the command again. One such source code is `PSL_UNKNOWN_DEFAULT_FUNCTION`, reported by the Prisma 8 PSL interpreter for a `@default` function the composed stack does not register; its message lists the supported functions, and for the removed `dbgenerated(...)` it is `` Default function "dbgenerated" was removed. Write the SQL as a tagged literal: @default(sql`<expression>`). Supported functions: <list>. ``

### CONTRACT.SOURCE_LOAD_FAILED

Loading the contract source failed: bundling or evaluating the TypeScript contract module (esbuild bundle error, or the module threw on import), the contract source provider returning a failure or a malformed result during `contract emit` or `contract print`, or `contract format` failing to read the PSL source file. The underlying failure is attached as `cause` where one exists. A structured error the source throws while loading, such as `CONTRACT.DEFAULT_INVALID` from a TypeScript builder, is not wrapped: the command reports it under its own code, with its message, `why`, `fix` and `meta` (including `reason`), and `--json` prints that envelope. Payload: `path`, `stage` (`bundle` or `import`) at the TS-loader site; `diagnostics`, `issues`, `providerMeta` at the emit provider site; none at the format read site. At the emit provider site the error also carries a `diagnostics` list with one finding per source diagnostic: under the source's own code when it is dotted (for example `PSL.PRISMA7_VIEW_UNSUPPORTED`), otherwise as `CONTRACT.SOURCE_DIAGNOSTIC`.

### CONTRACT.SQL_EXPRESSION_INTERPOLATION

The TypeScript `sql` template tag was given something other than a `sql` value inside `${…}`: ``sql`...` only interpolates other sql`...` values; write any other text inside the template.`` Such an interpolation is already a type error; this is the run-time check for JavaScript that is not type-checked. Renamed from `CONTRACT.DEFAULT_SQL_INTERPOLATION`, which the tag raised for every interpolation when it took no values. Meta: `index` (the position of the refused value).

### CONTRACT.SQL_EXPRESSION_INVALID

A TypeScript `sql` value cannot be made because its text cannot be canonicalized: it holds a NUL character, or it is larger than 65536 bytes. Raised by the `SqlExpression` constructor, which the `sql` tag calls, with the same messages as the PSL diagnostics `PSL_TAGGED_LITERAL_NUL` and `PSL_TAGGED_LITERAL_TOO_LARGE`. Also raised when a `sql` value made by another installed copy of the package reaches a builder field, `.default()` or another `sql` template, and its text has a NUL character or is too large: it is rebuilt with this copy's constructor, which refuses it with the same message. Also raised in lowering when the text a deferred index expression's `render` returns has a NUL character or is too large; the message then starts with the index, as in `Index "post_title_lower" expression: `, and meta adds `what`. Before the tag returned a `sql` value, this was `CONTRACT.DEFAULT_INVALID`. Meta: `reason` (`nul` or `too-large`), `offset`.

### CONTRACT.TABLE_AMBIGUOUS

A storage table name resolves in more than one namespace of the contract and needs namespace qualification to disambiguate. Raised whenever a bare table name is resolved against contract storage (authoring and runtime paths). Payload: `tableName`, `candidates`.

### CONTRACT.TABLE_MISMATCH

A foreign key or index references a table name that disagrees with the table the target model is actually mapped to. Raised while building a SQL contract. Payload: `sourceModel` (or `sourceTable` and `sourceNamespaceId` when a table node owns the foreign key), `referencedTable`, `mappedTable`.

### CONTRACT.TABLE_OWNED_BY_MODEL

A table node names a table a model maps and also states a table-level property: a primary key (`id`), unique constraints, indexes, check constraints, foreign keys or a control policy. The model owns those properties for its table, so a table node for that table may only add columns. Raised while building a SQL contract. The fix is to declare the property on the model, or drop it from the table node. Payload: `namespaceId`, `tableName`, `modelName`, `property`.

### CONTRACT.TABLE_UNKNOWN

A foreign key names its target by table, and no model or table node of the contract declares that table in that namespace. Raised while building a SQL contract. The fix is to declare the table, or correct the table name or namespace. Payload: `sourceModel`, or `sourceTable` and `sourceNamespaceId`, then `referencedTable`, `namespaceId`.

### CONTRACT.TARGET_MISMATCH

The contract's target does not match the target configured in `prisma.config.ts` (e.g. a Postgres contract with a SQLite config). `db verify` reports it as an `error` diagnostic on a completed run that exits `4`. Payload: `expected`, `actual`.

### CONTRACT.TYPE_PARAMS_INVALID

A column's type parameters do not fit its data type: a parameter fails the data type's schema (for example a `numeric` precision of 0 or an enum with no `typeName`), no written text of the data type takes that set of parameters (for example a `scale` with no `precision`), or no catalog text takes the parameters in their normal form. Raised by `renderSqlTypeName`, `renderSqlCatalogText`, `validateSqlTypeParams`, and `sqlBaseName` for a type that renders its own name, in `@internal/sql-contract/data-type`, when a type name is rendered. Also raised when a TypeScript contract is built and a column's `typeParams`, or those of the `storage.types` entry it references, fail its data type's schema; for example `varcharColumn(0)`, `numericColumn(2000)`, pgvector's `vector(0)` or PostGIS's `pgGeometryColumn({ srid: 0 })`. The column helpers check nothing themselves; the build does. A `storage.types` entry no column references is not checked. Payload: `dataType`, `parameters`, and, from the contract build, `modelName` and `fieldName`. Also raised when a Mongo contract written with `defineContract` is built and a field's `typeParams` fail its codec's data type schema, for example `field.vector({ typeParams: { length: 0 } })`; the payload then names `modelName` or `valueObjectName`, and `fieldName`.

A data type's `params` is the only place its bounds are written, and the code that reports a failure depends on where the parameters came from: a PSL type constructor argument is reported at the argument as the diagnostic `PSL_INVALID_ATTRIBUTE_ARGUMENT`; a TypeScript `type.*` constructor call raises `CONTRACT.ARGUMENT_INVALID` naming the argument; a column's parameters checked when a TypeScript contract is built, and a type name rendered from parameters, raise `CONTRACT.TYPE_PARAMS_INVALID`.

### CONTRACT.TYPE_UNKNOWN

A field never resolves to a storage descriptor: its builder has neither a column type nor an enum handle, which only JavaScript that is not type-checked can build. Raised during SQL contract lowering. Payload: `modelName`, `fieldName`, `reason: 'unresolved-storage-descriptor'`.

### CONTRACT.TYPES_KEY_REMOVED

A SQL TypeScript contract has a `types` key, on the `defineContract` definition or on the object its callback returns: `defineContract no longer takes a "types" key. Write a type alias as a constant, such as const Slug = field.column(type.VarChar(64)), and use it as a field. Register a database type of a contract space under "databaseTypes".` A type alias is now a field builder constant, which every column that uses it expands into; `databaseTypes` only registers a database type in the contract space's `storage.types`, as the pgvector and PostGIS spaces do, and no column refers to it. Raised by `defineContract` before the contract is built. `buildContractDefinition` refuses the same key with the same message, starting `buildContractDefinition no longer takes a "types" key.`; `buildSqlContractFromDefinition` refuses it on the contract definition, starting `buildSqlContractFromDefinition no longer takes a "types" key.` Payload: `keys`, the names under `types`.

### CONTRACT.UNREADABLE

The emitted contract file could not be read or parsed while computing `migration status`; reported as a warn-severity diagnostic on the status result rather than a thrown error, with the hint to re-run `prisma contract emit`. Payload: none (diagnostic carries `message` and `hints`).

### CONTRACT.TYPES_RENDER_FAILED

A command advancing a ref (`db sign`, `db init`, `db update`, `db migrate --advance-ref`) could not render the `contract.d.ts` of the contract it is about to snapshot: the family accepted the JSON but the emitter refused it (for example a to-one relation with no declared nullability). Raised before the command touches the database, so nothing is migrated and no ref or snapshot is written; run `prisma contract emit` to see the emitter's own diagnosis. The emitter's error is attached as `cause`. Payload: none (`where.path` names the contract JSON).

### CONTRACT.VALIDATION_FAILED

Aggregate contract validation failed: structural validation of the contract JSON (`ContractValidationError` with a `phase` of structural/domain/storage), semantic validation during `buildContract`, or storage/model validators rejecting the built contract. The SQL validators also refuse a domain field with no storage entry, an execution default on a column no field maps, and a relation that joins on a name that is not a field of its model (the target side of a many-to-many relation names junction columns and is exempt). Raised at emit/authoring time and whenever a contract is loaded and validated. Also raised by `migration new` when the emitted contract has no `storageHash`; that site has no meta. The CLI's fix names two cases: a contract an earlier release emitted is upgraded with the app upgrade instructions of each release since (`skills/prisma-8/upgrading/app`), which rewrite the contract and its migration snapshots, because `contract emit` does neither and refuses a schema an earlier release accepted; a contract this release emitted is emitted again with `contract emit`, or fixed by hand if it was edited. A SQL contract read from `contract.json` whose columns store `typeRef` is refused before its structure is checked, after the older `nativeType` and `noCheck` keys: `contracts no longer store type aliases, so re-emit the contract from its source, or rewrite a stored contract such as a migration snapshot with expand-type-aliases.ts, which ships in the expand-type-aliases scripts of the Prisma 8 upgrade guide. Columns: <the first five column paths>, and <n> more (<total> in all)`. A MongoDB contract read from `contract.json` is also refused when a collection validator does not require `_id` as BSON type `objectId` in every branch, or when an embed relation targets a model with variants. Payload: `errors` (aggregate site); the error class also carries `phase`.

### CONTRACT.VARIANT_COLUMN_NOT_ON_BASE_TABLE

A single-table-inheritance variant has a column that its base model's table does not have. The base model owns the shared table, so every column a variant uses must already be on that table; the PSL interpreter copies each variant column onto the base for this reason. Raised while building a SQL contract. The fix is to declare the column on the base model. Payload: `modelName`, `namespaceId`, `tableName`, `columnName`.

### CONTRACT.VERIFY_FAILED

`db verify` failed for a reason the verify result did not classify under a more specific code (marker, target, or schema-verification codes). Reported as an `error` diagnostic on a completed run that exits `4`, with the verify result's own text as the summary. Payload: none.

### CONTRACT.WIRE_NAME_PREFIX_TOO_LONG

An authored wire-name prefix (an index name, an RLS policy prefix, or a check's `name:` prefix) exceeds the 54-byte maximum: Postgres identifiers cap at 63 bytes and the wire name appends a 9-byte `_<8hex>` content-hash suffix. Raised at contract lowering. Payload: `prefix`, `maxBytes`.

## PSL

### PSL.FORMAT_OPTION_INVALID

`resolveFormatOptions` was given an invalid formatting option: a non-positive/non-integer `indent` or an unrecognized `newline` value. Raised before any PSL source is read. Payload: `option`, `received`.

### PSL.PARSE_FAILED

`format()` was asked to format PSL source that has parse errors; formatting refuses to run on an unparseable document. The message carries the first diagnostic and a count of the rest; the CLI `contract format` command wraps this into a structured failure telling the user to fix the parse errors, attaching the parser error as `cause`. Payload: `diagnostics`.

### PSL.PRISMA6_MONGO_COMPOSITE_ID_UNSUPPORTED

`@@id` on a model; a MongoDB document is identified by its `_id` field alone. Declare the id as `id String @id @default(auto()) @map("_id") @db.ObjectId`. Reported by the Prisma 6 MongoDB contract source (`prisma6Schema`) during `contract emit`, as a finding in the `diagnostics` list of `CONTRACT.SOURCE_LOAD_FAILED`, never on its own. `summary` is `<file>:<line>:<column> <message>`, with only the file when there is no position (the terminal prints the code before it), and `where` carries `path` and, when known, `line`. Payload: none.

### PSL.PRISMA6_MONGO_COMPOSITE_INDEX_PATH_UNSUPPORTED

An `@@index`, `@@unique`, or `@@fulltext` path that reaches into a composite type, such as `address.city` or `address.city(sort: Asc)`, which the Mongo contract cannot express yet. Index a top-level field or remove the index; either change also reaches the Prisma 6 app, whose `db push` builds its indexes from the schema. Reported by the Prisma 6 MongoDB contract source (`prisma6Schema`) during `contract emit`, as a finding in the `diagnostics` list of `CONTRACT.SOURCE_LOAD_FAILED`, never on its own. `summary` is `<file>:<line>:<column> <message>`, with only the file when there is no position (the terminal prints the code before it), and `where` carries `path` and, when known, `line`. Payload: none.

### PSL.PRISMA6_MONGO_COMPOSITE_MAP_UNSUPPORTED

`@map` on a field of a composite `type`. Prisma 8 stores each field of a value object under its own name ([ADR 309](../architecture%20docs/adrs/ADR%20309%20-%20Value%20objects%20are%20storage%20entities%2C%20and%20a%20discriminator%20column%20names%20a%20value%20set.md)), so rename the field to the name it is stored under and remove `@map`. Reported by the Prisma 6 MongoDB contract source (`prisma6Schema`) during `contract emit`, as a finding in the `diagnostics` list of `CONTRACT.SOURCE_LOAD_FAILED`, never on its own. `summary` is `<file>:<line>:<column> <message>`, with only the file when there is no position (the terminal prints the code before it), and `where` carries `path` and, when known, `line`. Payload: none.

### PSL.PRISMA6_MONGO_CONTRACT_INVALID

The Prisma 6 MongoDB schema gives a contract that Prisma 8 rejects, for a cause the source has no specific diagnostic for: a structured error was thrown while the contract was built, or the contract failed the domain or storage check. This is a bug in Prisma ORM; the message names the cause, and the user should report it with the schema. Reported at the schema path by the Prisma 6 MongoDB contract source (`prisma6Schema`) during `contract emit`, as a finding in the `diagnostics` list of `CONTRACT.SOURCE_LOAD_FAILED`, never on its own. `summary` is `<file> <message>` (the terminal prints the code before it), and `where` carries `path`. Payload: none; the error's `providerMeta` carries `schemaPath` and the thrown error's `code`.

### PSL.PRISMA6_MONGO_DEFAULT_UNSUPPORTED

A `@default` other than `now()` on a `DateTime` field and `auto()` on the id: a literal, `uuid()`, `cuid()`, `dbgenerated(...)`, `now()` on another type, or `auto()` on another field. MongoDB has no stored defaults, and Prisma 8 fills only `now()`. The Prisma 6 client fills the default today, so the message says what removing it does to the Prisma 6 app: a required field must then be passed to every Prisma 6 create call, and an optional or list field no longer gets the default. Set the value in application code, then remove the default. Reported by the Prisma 6 MongoDB contract source (`prisma6Schema`) during `contract emit`, as a finding in the `diagnostics` list of `CONTRACT.SOURCE_LOAD_FAILED`, never on its own. `summary` is `<file>:<line>:<column> <message>`, with only the file when there is no position (the terminal prints the code before it), and `where` carries `path` and, when known, `line`. Payload: none.

### PSL.PRISMA6_MONGO_ID_NOT_OBJECTID

The model's `@id` is not a required `String @db.ObjectId` stored as `_id`. Declare it as `id String @id @default(auto()) @map("_id") @db.ObjectId`. Stored documents keep their `_id` values, so a model whose stored `_id` values are not ObjectIds cannot use the source until they, and every field that refers to them, are rewritten. Reported by the Prisma 6 MongoDB contract source (`prisma6Schema`) during `contract emit`, as a finding in the `diagnostics` list of `CONTRACT.SOURCE_LOAD_FAILED`, never on its own. `summary` is `<file>:<line>:<column> <message>`, with only the file when there is no position (the terminal prints the code before it), and `where` carries `path` and, when known, `line`. Payload: none.

### PSL.PRISMA6_MONGO_IGNORED_FIELD_REFERENCED

An `@ignore`d field is used by `@unique`, `@@unique`, `@@index`, `@@fulltext`, or a relation's `fields:` or `references:`, and Prisma 6 still creates that index or reads that key. Remove `@ignore` from the field, which adds it to the Prisma 6 client, or remove what uses it: removing an index makes Prisma 6 `db push` drop it, and removing a relation field removes that relation from the Prisma 6 client. Reported by the Prisma 6 MongoDB contract source (`prisma6Schema`) during `contract emit`, as a finding in the `diagnostics` list of `CONTRACT.SOURCE_LOAD_FAILED`, never on its own. `summary` is `<file>:<line>:<column> <message>`, with only the file when there is no position (the terminal prints the code before it), and `where` carries `path` and, when known, `line`. Payload: none.

### PSL.PRISMA6_MONGO_INDEX_ARGUMENT_UNSUPPORTED

An index argument a Mongo contract index cannot carry, such as `length`, an unknown argument, or a dotted path whose first segment is not a composite-type field (`title.first`), which Prisma 6 refuses as an unknown field. `sort` is read, and `map` and `name` are accepted and dropped, since Mongo verify matches indexes by keys and options. Remove the argument. Reported by the Prisma 6 MongoDB contract source (`prisma6Schema`) during `contract emit`, as a finding in the `diagnostics` list of `CONTRACT.SOURCE_LOAD_FAILED`, never on its own. `summary` is `<file>:<line>:<column> <message>`, with only the file when there is no position (the terminal prints the code before it), and `where` carries `path` and, when known, `line`. Payload: none.

### PSL.PRISMA6_MONGO_LIST_RELATION_UNSUPPORTED

A list relation whose keys live in a list field (a many-to-many relation on MongoDB), which Prisma 8 does not support yet. Remove the relation fields and keep the key list as a plain field; the Prisma 6 client then loses the relation fields too, so Prisma 6 code that uses them has to use the key list. Reported by the Prisma 6 MongoDB contract source (`prisma6Schema`) during `contract emit`, as a finding in the `diagnostics` list of `CONTRACT.SOURCE_LOAD_FAILED`, never on its own. `summary` is `<file>:<line>:<column> <message>`, with only the file when there is no position (the terminal prints the code before it), and `where` carries `path` and, when known, `line`. Payload: none.

### PSL.PRISMA6_MONGO_NATIVE_TYPE_UNSUPPORTED

A `@db.*` attribute the source does not read. The source reads every native type Prisma 6.19 accepts on MongoDB, as the codec for the BSON type it stores, except `DateTime @db.Timestamp`: Prisma 8 has no codec for a BSON timestamp. Remove it; the message says that the Prisma 6 client then stores new values as BSON date, and that documents already stored keep their timestamp values until they are rewritten as dates. An attribute Prisma 6 itself rejects on that field type is named as such. Reported by the Prisma 6 MongoDB contract source (`prisma6Schema`) during `contract emit`, as a finding in the `diagnostics` list of `CONTRACT.SOURCE_LOAD_FAILED`, never on its own. `summary` is `<file>:<line>:<column> <message>`, with only the file when there is no position (the terminal prints the code before it), and `where` carries `path` and, when known, `line`. Payload: none.

### PSL.PRISMA6_MONGO_OPTIONAL_GENERATED_FIELD_UNSUPPORTED

`@default(now())` or `@updatedAt` on an optional field. Make the field required once every stored document has a value, or remove the attribute and set the value in application code. Either fix also changes the Prisma 6 app: the Prisma 6 client fails on a stored document that lacks a required field, and without the attribute it no longer fills the field. Reported by the Prisma 6 MongoDB contract source (`prisma6Schema`) during `contract emit`, as a finding in the `diagnostics` list of `CONTRACT.SOURCE_LOAD_FAILED`, never on its own. `summary` is `<file>:<line>:<column> <message>`, with only the file when there is no position (the terminal prints the code before it), and `where` carries `path` and, when known, `line`. Payload: none.

### PSL.PRISMA6_MONGO_PROVIDER_MISMATCH

The Prisma 6 schema has no `datasource` block, or its `provider` is not `mongodb`. Use the source only with a MongoDB schema. The source stops at this finding and reports nothing about the models, so the only other findings are parse errors. Reported by the Prisma 6 MongoDB contract source (`prisma6Schema`) during `contract emit`, as a finding in the `diagnostics` list of `CONTRACT.SOURCE_LOAD_FAILED`, never on its own. `summary` is `<file>:<line>:<column> <message>`, with only the file when there is no position (the terminal prints the code before it), and `where` carries `path` and, when known, `line`. Payload: none.

### PSL.PRISMA6_MONGO_REFERENTIAL_ACTION_UNSUPPORTED

`onDelete`, `onUpdate`, or `map` on `@relation`. Prisma 8 enforces no referential actions on MongoDB, and MongoDB has no foreign key constraint for `map` to name. The Prisma 6 client emulates referential actions, so removing `onDelete` or `onUpdate` can change the Prisma 6 app: its client then applies its default, `Restrict` for `onDelete` on a required relation (deleting a parent that still has children fails with P2014), `SetNull` for `onDelete` on an optional one (the children's key is set to null), and `Cascade` for `onUpdate`. The message names the default and its effect, or says nothing changes when the argument already names the default. Handle related documents in application code, then remove the argument. Removing `map` changes nothing in the Prisma 6 app. Reported by the Prisma 6 MongoDB contract source (`prisma6Schema`) during `contract emit`, as a finding in the `diagnostics` list of `CONTRACT.SOURCE_LOAD_FAILED`, never on its own. `summary` is `<file>:<line>:<column> <message>`, with only the file when there is no position (the terminal prints the code before it), and `where` carries `path` and, when known, `line`. Payload: none.

### PSL.PRISMA6_MONGO_SCHEMA_READ_FAILED

The schema path could not be read, or the schema directory holds no `.prisma` file. When nothing exists at the path, the message says so and names `prisma6Schema()` in `prisma.config.ts` as the place to fix it. Reported at the schema path by the Prisma 6 MongoDB contract source (`prisma6Schema`) during `contract emit`, as a finding in the `diagnostics` list of `CONTRACT.SOURCE_LOAD_FAILED`, never on its own. `summary` is `<file> <message>` (the terminal prints the code before it), and `where` carries `path`. Payload: none; the error's `providerMeta` carries the schema path.

### PSL.PRISMA6_MONGO_SCHEMA_UNSUPPORTED

`@@schema` on a model or enum; a MongoDB contract has one database, bound by the connection string. Remove `@@schema`. Reported by the Prisma 6 MongoDB contract source (`prisma6Schema`) during `contract emit`, as a finding in the `diagnostics` list of `CONTRACT.SOURCE_LOAD_FAILED`, never on its own. `summary` is `<file>:<line>:<column> <message>`, with only the file when there is no position (the terminal prints the code before it), and `where` carries `path` and, when known, `line`. Payload: none.

### PSL.PRISMA6_MONGO_GENERATED_VALUE_CONFLICT

Two models stored in one collection generate a value for the same stored field differently, such as `@default(now())` on one and `@updatedAt` on the other: `Field "<Model>.<field>" generates its value differently from "<Other>.<field>", which is stored in the same field "<stored>" of collection "<collection>". Give both fields the same @default(now()) or @updatedAt.` A generated value applies to every document in the collection, so both models must agree. Reported at the second field by the Prisma 6 MongoDB contract source (`prisma6Schema`) during `contract emit`, as a finding in the `diagnostics` list of `CONTRACT.SOURCE_LOAD_FAILED`, never on its own. Payload: none.

### PSL.PRISMA6_MONGO_TEXT_INDEX_LIMIT

A model with more than one `@@fulltext`, or two models stored in one collection that each have one; MongoDB allows one text index per collection. Merge the fields into one `@@fulltext`. Reported by the Prisma 6 MongoDB contract source (`prisma6Schema`) during `contract emit`, as a finding in the `diagnostics` list of `CONTRACT.SOURCE_LOAD_FAILED`, never on its own. `summary` is `<file>:<line>:<column> <message>`, with only the file when there is no position (the terminal prints the code before it), and `where` carries `path` and, when known, `line`. Payload: none.

### PSL.PRISMA6_MONGO_UNKNOWN_ATTRIBUTE

An attribute the source does not read. Remove it. Reported by the Prisma 6 MongoDB contract source (`prisma6Schema`) during `contract emit`, as a finding in the `diagnostics` list of `CONTRACT.SOURCE_LOAD_FAILED`, never on its own. `summary` is `<file>:<line>:<column> <message>`, with only the file when there is no position (the terminal prints the code before it), and `where` carries `path` and, when known, `line`. Payload: none.

### PSL.PRISMA6_MONGO_UNSUPPORTED_TYPE

A field of type `Unsupported("...")`, which has no Prisma 8 codec, or of a type name that is not a scalar type, enum, composite type, or model. For `Unsupported`, Prisma 6 rejects `@ignore` on the field; remove the field, or add `@@ignore` to the model, which also needs `@ignore` on every relation field that points to it. For an unknown name, correct the type name. Reported by the Prisma 6 MongoDB contract source (`prisma6Schema`) during `contract emit`, as a finding in the `diagnostics` list of `CONTRACT.SOURCE_LOAD_FAILED`, never on its own. `summary` is `<file>:<line>:<column> <message>`, with only the file when there is no position (the terminal prints the code before it), and `where` carries `path` and, when known, `line`. Payload: none.

### PSL.PRISMA6_MONGO_UPDATED_AT_TYPE_UNSUPPORTED

`@updatedAt` on a field that is not a `DateTime`. Removing it also stops the Prisma 6 client from setting the field on every update; set the value in application code, then remove `@updatedAt`. Reported by the Prisma 6 MongoDB contract source (`prisma6Schema`) during `contract emit`, as a finding in the `diagnostics` list of `CONTRACT.SOURCE_LOAD_FAILED`, never on its own. `summary` is `<file>:<line>:<column> <message>`, with only the file when there is no position (the terminal prints the code before it), and `where` carries `path` and, when known, `line`. Payload: none.

### PSL.PRISMA6_MONGO_VIEW_UNSUPPORTED

A `view` block; Prisma 8 has no views on MongoDB. Remove the view from the schema the source reads; the Prisma 6 client then loses the view's model too. Reported by the Prisma 6 MongoDB contract source (`prisma6Schema`) during `contract emit`, as a finding in the `diagnostics` list of `CONTRACT.SOURCE_LOAD_FAILED`, never on its own. `summary` is `<file>:<line>:<column> <message>`, with only the file when there is no position (the terminal prints the code before it), and `where` carries `path` and, when known, `line`. Payload: none.

### PSL.PRISMA7_CONTRACT_INVALID

The Prisma 7 schema gives a contract that Prisma 8 rejects, for a cause the source has no specific diagnostic for: a structured error was thrown while the contract was built, or the contract failed the domain, storage consistency, or model storage reference check. This is a bug in Prisma ORM; the message names the cause, and the user should report it with the schema. Reported at the schema path by the Prisma 7 contract source (`prisma7Schema`) during `contract emit`, as a finding in the `diagnostics` list of `CONTRACT.SOURCE_LOAD_FAILED`, never on its own. `summary` is `<file>:<line>:<column> <message>`, with only the file when there is no position (the terminal prints the code before it), and `where` carries `path` and, when known, `line`. Payload: none; the error's `providerMeta` carries `schemaPath` and the thrown error's `code`.

### PSL.PRISMA7_CONSTRAINT_NAME_TOO_LONG

A `map` on `@id`, `@@id`, `@unique`, `@@unique`, `@@index` or `@relation` is longer than the database keeps an identifier (63 bytes on Postgres). The database would store the name cut short, so a contract holding the whole name would rename or drop a constraint the database does not have; Prisma 7 refuses the same `map`. The message names the attribute, the name, its length in bytes and the limit. Shorten the `map`. Reported by the Prisma 7 contract source (`prisma7Schema`) during `contract emit` or `contract print`, as a finding in the `diagnostics` list of `CONTRACT.SOURCE_LOAD_FAILED`, never on its own. `summary` is `<file>:<line>:<column> <message>`, with only the file when there is no position (the terminal prints the code before it), and `where` carries `path` and, when known, `line`. Payload: none.

### PSL.PRISMA7_ENUM_NAMESPACE_MISMATCH

A field uses an enum declared under a different `@@schema`; a Postgres enum lives in one schema and a Prisma 8 column references the enum of its own namespace. Declare the enum in the model's schema, or move the model. Reported by the Prisma 7 contract source (`prisma7Schema`) during `contract emit` or `contract print`, as a finding in the `diagnostics` list of `CONTRACT.SOURCE_LOAD_FAILED`, never on its own. `summary` is `<file>:<line>:<column> <message>`, with only the file when there is no position (the terminal prints the code before it), and `where` carries `path` and, when known, `line`. Payload: none.

### PSL.PRISMA7_IGNORED_FIELD_REFERENCED

An `@ignore`d field, or an `Unsupported("...")` field of a model that is not `@@ignore`, is part of the model's primary key (`@id` or `@@id`), or a relation that is not `@ignore` joins on it through `fields:` or `references:`. Prisma 8 keeps the column of such a field in the table but leaves the field out of the model. Without its primary-key field the model has no field that identifies a row, so Prisma 8 could not update, delete or relate its rows: remove `@ignore` from the field, or replace it with `@@ignore` on the model, which keeps the table with its primary key and removes the model from both clients; Prisma 7 then requires `@ignore` on every relation field that points to the model. A relation joins on fields: remove `@ignore` from the field, or mark the relation field `@ignore` as well, which keeps its foreign key and leaves the relation out of the contract's models. For an `Unsupported` field, the message says so and gives only the second edit: `@@ignore` on the model, or `@ignore` on the relation field. Reported by the Prisma 7 contract source (`prisma7Schema`) during `contract emit` or `contract print`, as a finding in the `diagnostics` list of `CONTRACT.SOURCE_LOAD_FAILED`, never on its own. `summary` is `<file>:<line>:<column> <message>`, with only the file when there is no position (the terminal prints the code before it), and `where` carries `path` and, when known, `line`. Payload: none.

### PSL.PRISMA7_INDEX_ARGUMENT_UNSUPPORTED

An index argument Prisma 8 indexes cannot carry (`sort`, `length`, `ops`, an unknown index type), a dotted path such as `title.length` (Prisma 7 refuses it as an unknown field), or an indexed field that is not a column. Remove the argument, or list fields of the model by name. Reported by the Prisma 7 contract source (`prisma7Schema`) during `contract emit` or `contract print`, as a finding in the `diagnostics` list of `CONTRACT.SOURCE_LOAD_FAILED`, never on its own. `summary` is `<file>:<line>:<column> <message>`, with only the file when there is no position (the terminal prints the code before it), and `where` carries `path` and, when known, `line`. Payload: none.

### PSL.PRISMA7_JSON_NULL_DEFAULT_UNSUPPORTED

A `Json` default of `"null"`, or a `Json[]` default holding it: the contract cannot tell the JSON value null apart from SQL `NULL`. Remove the `@default` or give it another JSON value. Reported by the Prisma 7 contract source (`prisma7Schema`) during `contract emit` or `contract print`, as a finding in the `diagnostics` list of `CONTRACT.SOURCE_LOAD_FAILED`, never on its own. `summary` is `<file>:<line>:<column> <message>`, with only the file when there is no position (the terminal prints the code before it), and `where` carries `path` and, when known, `line`. Payload: none.

### PSL.PRISMA7_JUNCTION_ID_UNSUPPORTED

An implicit many-to-many relation on a model without a single-field `@id`. Give the model a single-field `@id`, or write the junction model out. Reported by the Prisma 7 contract source (`prisma7Schema`) during `contract emit` or `contract print`, as a finding in the `diagnostics` list of `CONTRACT.SOURCE_LOAD_FAILED`, never on its own. `summary` is `<file>:<line>:<column> <message>`, with only the file when there is no position (the terminal prints the code before it), and `where` carries `path` and, when known, `line`. Payload: none.

### PSL.PRISMA7_JUNCTION_NAME_COLLISION

A model in the same schema as an implicit many-to-many junction has the junction model's name (`PostToTag`, or the relation name). Rename the model and keep its table with `@@map`. Reported by the Prisma 7 contract source (`prisma7Schema`) during `contract emit` or `contract print`, as a finding in the `diagnostics` list of `CONTRACT.SOURCE_LOAD_FAILED`, never on its own. `summary` is `<file>:<line>:<column> <message>`, with only the file when there is no position (the terminal prints the code before it), and `where` carries `path` and, when known, `line`. Payload: none.

### PSL.PRISMA7_NATIVE_TYPE_UNSUPPORTED

A `@db.*` type with no Prisma 8 codec yet (`Citext`, `Bit`, `VarBit`, `Xml`, `Oid`, `Money`, or an unknown spelling). Prisma 8 cannot read the schema until it supports the column type. `@ignore` and `@@ignore` do not help, because Prisma 8 keeps the columns of ignored fields and models in the contract. Changing the field's type to one Prisma 8 supports changes the column type on Prisma 7's next migration. Reported by the Prisma 7 contract source (`prisma7Schema`) during `contract emit` or `contract print`, as a finding in the `diagnostics` list of `CONTRACT.SOURCE_LOAD_FAILED`, never on its own. `summary` is `<file>:<line>:<column> <message>`, with only the file when there is no position (the terminal prints the code before it), and `where` carries `path` and, when known, `line`. Payload: none.

### PSL.PRISMA7_PROVIDER_MISMATCH

The Prisma 7 schema has no `datasource` block, or its `provider` is not one the target accepts (`postgresql` or `postgres` for Postgres). Use the source only with a schema for the configured target. Reported by the Prisma 7 contract source (`prisma7Schema`) during `contract emit` or `contract print`, as a finding in the `diagnostics` list of `CONTRACT.SOURCE_LOAD_FAILED`, never on its own. `summary` is `<file>:<line>:<column> <message>`, with only the file when there is no position (the terminal prints the code before it), and `where` carries `path` and, when known, `line`. Payload: none.

### PSL.PRISMA7_REFERENTIAL_ACTION_UNSUPPORTED

`SetNull` on a relation over a required foreign key field, or `SetDefault` over a required field with no column default. Make the fields optional, give them a column default, or choose another action. Reported by the Prisma 7 contract source (`prisma7Schema`) during `contract emit` or `contract print`, as a finding in the `diagnostics` list of `CONTRACT.SOURCE_LOAD_FAILED`, never on its own. `summary` is `<file>:<line>:<column> <message>`, with only the file when there is no position (the terminal prints the code before it), and `where` carries `path` and, when known, `line`. Payload: none.

### PSL.PRISMA7_RELATION_MODE_UNSUPPORTED

`relationMode = "prisma"`, or the older `referentialIntegrity = "prisma"`. Remove it or set `relationMode = "foreignKeys"`. Reported by the Prisma 7 contract source (`prisma7Schema`) during `contract emit` or `contract print`, as a finding in the `diagnostics` list of `CONTRACT.SOURCE_LOAD_FAILED`, never on its own. `summary` is `<file>:<line>:<column> <message>`, with only the file when there is no position (the terminal prints the code before it), and `where` carries `path` and, when known, `line`. Payload: none.

### PSL.PRISMA7_RELATION_NAME_SHARED

Two or more implicit many-to-many relations in the same schema use the same relation name; Prisma 7 creates one table for all of them, wired to only one. Give each relation its own name. Reported by the Prisma 7 contract source (`prisma7Schema`) during `contract emit` or `contract print`, as a finding in the `diagnostics` list of `CONTRACT.SOURCE_LOAD_FAILED`, never on its own. `summary` is `<file>:<line>:<column> <message>`, with only the file when there is no position (the terminal prints the code before it), and `where` carries `path` and, when known, `line`. Payload: none.

### PSL.PRISMA7_RELATION_UNRESOLVED

A relation field that cannot be paired: no matching side, an ambiguous unnamed pair, a singular back-relation over a non-unique foreign key, a `fields`/`references` mismatch, or a required relation field over an optional foreign key field. Name both sides with `@relation("name")`, add the missing `fields`/`references`, or make the relation field optional. Reported by the Prisma 7 contract source (`prisma7Schema`) during `contract emit` or `contract print`, as a finding in the `diagnostics` list of `CONTRACT.SOURCE_LOAD_FAILED`, never on its own. `summary` is `<file>:<line>:<column> <message>`, with only the file when there is no position (the terminal prints the code before it), and `where` carries `path` and, when known, `line`. Payload: none.

### PSL.PRISMA7_SCHEMA_READ_FAILED

The schema path could not be read, or the schema directory holds no `.prisma` file. When nothing exists at the path, the message says so and names `prisma7Schema()` in `prisma.config.ts` as the place to fix it. Reported at the schema path by the Prisma 7 contract source (`prisma7Schema`) during `contract emit`, as a finding in the `diagnostics` list of `CONTRACT.SOURCE_LOAD_FAILED`, never on its own. `summary` is `<file>:<line>:<column> <message>`, with only the file when there is no position (the terminal prints the code before it), and `where` carries `path` and, when known, `line`. Payload: none; the error's `providerMeta` carries the schema path.

### PSL.PRISMA7_TABLE_COLLISION

Two models map to the same table in one schema, or a model maps to the table of an implicit many-to-many relation. Give each model its own table with `@@map`. Reported by the Prisma 7 contract source (`prisma7Schema`) during `contract emit` or `contract print`, as a finding in the `diagnostics` list of `CONTRACT.SOURCE_LOAD_FAILED`, never on its own. `summary` is `<file>:<line>:<column> <message>`, with only the file when there is no position (the terminal prints the code before it), and `where` carries `path` and, when known, `line`. Payload: none.

### PSL.PRISMA7_UNKNOWN_ATTRIBUTE

An attribute Prisma 7 for the target does not have, or one the source does not read (`@@fulltext`, `@shardKey`), or a `@db.*` native type on an `Unsupported("...")` field, which Prisma 7 refuses too. Remove it. Reported by the Prisma 7 contract source (`prisma7Schema`) during `contract emit` or `contract print`, as a finding in the `diagnostics` list of `CONTRACT.SOURCE_LOAD_FAILED`, never on its own. `summary` is `<file>:<line>:<column> <message>`, with only the file when there is no position (the terminal prints the code before it), and `where` carries `path` and, when known, `line`. Payload: none.

### PSL.PRISMA7_UNKNOWN_DEFAULT

A `@default` value the source cannot read, or one the column's data type or codec refuses. The message is `Field "<Model>.<field>": @default <reason>`. Every reason below carries ` at element <n>` after the value it is about when that value is one element of a list. The reasons that come from reading the value are: `holds text that this contract source does not read: <the reading entry's message>`; `holds a <tag> literal, which this stack does not register.`; `holds a <string|boolean|number> value, which this target has no data type for.`; `holds a <value type> value, which <column type> has no cast from; it casts from <types>.` (or `it casts from nothing`); `holds a list, which <column type> has no cast from; it casts from <types>.` for a list written on a column whose type has no list cast; `holds a <value type> value, which the list cast of <column type> does not take; it takes <element types>.` for an element of a list written on a column whose type has a list cast; and `holds a value that <codecId> does not read: <the codec's message>`. The rest do not involve the value's type — an unknown function, an enum member on a non-enum field or a non-member, a `dbgenerated(...)` argument list that is not a single positional string with text in it, and any default other than `dbgenerated(...)` on an `Unsupported("...")` field, which Prisma 7 refuses too. Write a value of a type the column's type is or casts from, an enum member, or a supported function. Reported by the Prisma 7 contract source (`prisma7Schema`) during `contract emit` or `contract print`, as a finding in the `diagnostics` list of `CONTRACT.SOURCE_LOAD_FAILED`, never on its own. `summary` is `<file>:<line>:<column> <message>`, with only the file when there is no position (the terminal prints the code before it), and `where` carries `path` and, when known, `line`. Payload: none.

### PSL.PRISMA7_GENERATOR_REFUSED

A client function in `@default` that the column refuses, such as `@db.Char(10) @default(nanoid())`: `Field "<Model>.<field>": @default(nanoid()) cannot fill its column: nanoid() writes 21 characters, which does not fit a column of 10 characters.` Postgres refuses an insert of such a value, so Prisma 7 could not store one either. Widen the column, or pass a size that fits, such as `nanoid(10)`. Reported by the Prisma 7 contract source (`prisma7Schema`) during `contract emit` or `contract print`, as a finding in the `diagnostics` list of `CONTRACT.SOURCE_LOAD_FAILED`, never on its own. `summary` is `<file>:<line>:<column> <message>`, with only the file when there is no position (the terminal prints the code before it), and `where` carries `path` and, when known, `line`. Payload: none.

### PSL.PRISMA7_UNSUPPORTED_TYPE

An unknown field type, or a type constructor other than `Unsupported("...")`, which Prisma 7 refuses too: correct the type name. An `Unsupported("...")` field is read as a raw column with no field (ADR 273), and is reported here when its argument is not one double-quoted string (`Field "<Model>.<field>": Unsupported(...) takes one string, the column's type as the database prints it, such as Unsupported("tsvector").`) or when its text is not one type name (`Field "<Model>.<field>": Unsupported("<text>") is not one type name: <reason>`, the `sql/raw` data type's reason). Write the column's type as the database prints it. Reported by the Prisma 7 contract source (`prisma7Schema`) during `contract emit` or `contract print`, as a finding in the `diagnostics` list of `CONTRACT.SOURCE_LOAD_FAILED`, never on its own. `summary` is `<file>:<line>:<column> <message>`, with only the file when there is no position (the terminal prints the code before it), and `where` carries `path` and, when known, `line`. Payload: none.

### PSL.PRISMA7_UPDATED_AT_FIELD_INVALID

`@updatedAt` on a field whose type is not `DateTime`, on a list field such as `DateTime[]`, or on a `DateTime` field whose native type is not a date or time, such as `@db.Text`, `@db.Integer` or `@db.VarChar(20)`. Prisma 7 refuses all three too, with "Fields that are marked with @updatedAt must be of type DateTime.", "Fields that are marked with @updatedAt cannot be lists." and "Native type Text is not compatible with declared field type DateTime". Remove `@updatedAt`, or make the field a single `DateTime` with a date or time native type. Reported at the `@updatedAt` attribute, or at the native type attribute for the third case, by the Prisma 7 contract source (`prisma7Schema`) during `contract emit` or `contract print`, as a finding in the `diagnostics` list of `CONTRACT.SOURCE_LOAD_FAILED`, never on its own. `summary` is `<file>:<line>:<column> <message>`, with only the file when there is no position (the terminal prints the code before it), and `where` carries `path` and, when known, `line`. Payload: none.

### PSL.PRISMA7_VIEW_UNSUPPORTED

A `view` block; Prisma 8 has no views. Remove the view, or replace it with a model over the underlying table. Reported by the Prisma 7 contract source (`prisma7Schema`) during `contract emit` or `contract print`, as a finding in the `diagnostics` list of `CONTRACT.SOURCE_LOAD_FAILED`, never on its own. `summary` is `<file>:<line>:<column> <message>`, with only the file when there is no position (the terminal prints the code before it), and `where` carries `path` and, when known, `line`. Payload: none.

### PSL_BACKTICK_STRING_REQUIRES_TAG

A backtick string appears somewhere other than after a tag, for example `` @map(`x`) `` or `` provider = `x` ``: `` A backtick string must follow a tag, as in tag`...`. `` Reported at the string. Write a `"` or `'` string there, or put the tag in front of it, as in `` @default(sql`...`) ``.

### PSL_UNKNOWN_LITERAL_TAG

A tagged literal uses a tag no pack in the stack registered: `Unknown literal tag "<tag>". Known tags: <tags in registration order>.` In a `@default` the message starts with the field it is about, `Field "<Model>.<field>": `, with ` at element <n>` after the field when the literal is one element of a written list. The SQL family registers `sql`, and every SQL target registers `json`. `pg.sql` and `sqlite.sql` are not registered; write `sql`. At a place that takes raw SQL (`@@index(where:)`, `@@index(expression:)`, `@@fullTextIndex(where:)`, `@@check(expression:)`, a policy's `using` and `withCheck`) the message has no prefix. Reported at the literal.

### PSL_INVALID_ATTRIBUTE_SYNTAX

An attribute or block argument is not written in a form its specification accepts. At a place that takes raw SQL, an argument that is not a literal, such as an identifier, reads ``Expected sql`...`; got an identifier``; write the SQL as a `sql` literal. Reported at the argument.

### PSL_DEPRECATED_SCALAR_NAME

A warning, not an error: a Mongo schema types a field with a deprecated scalar name, `Int`, `Float`, `Boolean` or `DateTime`: `Scalar type "<old>" is deprecated and will be removed; use "<new>".` Reported at the type through the contract source's `reportWarning`; `prisma contract emit` prints it and still writes the contract, which is the same as the new name gives, and the language server shows it with warning severity. Rename the type to `Int32`, `Double`, `Bool` or `Date`.

### PSL_UNRESOLVED_REFERENCE

A name in the schema refers to nothing in scope: a field's type (`Cannot find type "<name>"`), a mixin (`Cannot find mixin "<name>"`), a field (`Cannot find field "<name>" on "<owner>"`) or an entity (`Cannot find entity "<name>"`). Reported at the name, in SQL and Mongo schemas. Correct the name, or add the extension that contributes it.

Three field types get a message that names what to write instead:

- A call to a field preset, which Prisma 8 removed: `<call as written> was a field preset, and Prisma 8 removed field presets. Write <replacement>.` For example, `id.uuidv4String() was a field preset, and Prisma 8 removed field presets. Write UuidString @id @onCreate(uuid()).` and `temporal.time(3, onUpdate: now) was a field preset, and Prisma 8 removed field presets. Write Time(3) @onUpdate(now()).` The replacement stores the same contract, so nothing is re-emitted or migrated. It is built from the call's arguments: the precision, `onCreate: now` and `onUpdate: now`, and the `size` of `nanoid`. When an argument is not one the preset took, the message gives the type and the attributes to add, as in `Write TimestampTemporal(...) with @onCreate(now()) and @onUpdate(now()) for the phases the preset set.` A name is refused this way only on a target that had the preset, so `json()` on SQLite keeps `Cannot find type "json"`.
- `Unsupported("<type>")`, the Prisma 6 and Prisma 7 form for a column of a type they do not know, in a SQL schema: ``Unsupported("<type>") is not a Prisma 8 type. Write the column's type with a type constructor, or as Raw(sql`<type>`) when no type constructor names it.`` followed by a sentence about adding the extension's pack when the type comes from a database extension.
- In a SQL schema, a bare name that a contributed namespace holds, such as `Ulid` on SQLite, where only `sql.Ulid` exists: `Cannot find type "Ulid". Did you mean sql.Ulid?`

### PSL_TYPE_CONSTRUCTOR_NOT_CALLED

A field is typed with a type constructor's name but does not call it, and the constructor needs an argument, for example `embedding Vector` instead of `embedding Vector(1536)`, or `level pg.enum` instead of `level pg.enum(AalLevel)`: `Field "<Model>.<field>" uses type constructor "<constructor>" without arguments. Write <constructor>(<arguments>).` The message names each required argument; an argument that names another entity is named by that entity's kind, such as `native_enum`. A type constructor whose arguments are all optional can be written without a call. Reported at the field, in SQL and Mongo schemas. Call the constructor with its arguments.

### PSL_VALUE_TYPE_INCOMPATIBLE

A written value has a data type the receiving type neither is nor casts from: `Expected <forms>`, where `<forms>` says how a value the receiving type takes is written — `a number`, `true or false`, `a quoted string`, `` json`...` `` — joined with `or`. When the value is written in one of those forms and its type is still refused, such as a number too large for the receiving type or one with a fraction for a whole-number type, the message names both types: `Expected <forms> that <receiving type> can hold; got <value type>`. A quoted string refused by a type that has a tag also gets the literal to write, as in ``Expected sql`...`; write sql`now()` ``, when that literal reads back as the same text and the receiving type takes it. A `@default` gets it too: ``Field "<Model>.<field>": Expected json`...`; write json`{}` ``. For a `@default` the receiving type is the column's, and the message starts with the field: `Field "<Model>.<field>": Expected a number that pg/int4 can hold; got pg/int8`. A written value has a data type of its own — a number's comes from its own size and precision, so on Postgres `42` is `pg/int2` and `100000000000000099` is `pg/int8` — and a data type declares which other types' values it takes. Inside a written list the message names the element: `Field "<Model>.<field>" at element 2: ...`. A list written on a column that holds one value is `Expected <forms>; got a list` when the column's type has no list cast. When it has one, an element the list cast does not take is worded as above, with `<forms>` the forms of the list cast's element types and the column's type as the receiving type: `Field "<Model>.<field>" at element <n>: Expected a number`. A `sql` literal inside a list literal is reported like any other element. For a `@default` on a column whose type nothing writes, `<forms>` is `` sql`...` ``, the one form `@default` takes for every column.

An `enum` member written in PSL, in either family, is a written value of the enum codec's data type, and a refused member is worded exactly as the same value refused as a `@default`, with `enum "<name>" member "<member>"` in place of `Field "<Model>.<field>"`. A quoted member is text, so on a codec whose data type has no cast from text it is refused with the literal to write: `enum "Ratio" member "Half": Expected a number; write 0.5` for `Half = "0.5"` under `pg/numeric@1`, ``enum "Launch" member "Day": Expected date`...`; write date`2024-01-02` `` under `pg/date-temporal@1`, ``enum "Doc" member "Low": Expected json`...`; write json`"low"` `` under `sqlite/json@1`, and `enum "Ratio" member "Unknown": Expected a number; write NaN` for `Unknown = "NaN"` under `mongo/double@1`. The literal is offered only when it stores what the quoted text says, so `Zero = "-0"` under `mongo/decimal128@1` is `Expected a number` alone: `-0` is an int32 zero, stored without its sign. A number member under a text codec is `enum "<name>" member "<member>": Expected a quoted string`, and one too large for the codec's type names both types, as in `Expected a number that pg/int4 can hold; got pg/int8`. On MongoDB a number with a fraction is a Decimal128 value, so `One = 1.0` under `mongo/int32@1` is `Expected a number that mongo/int32 can hold; got mongo/decimal128`. A member written as a list is read through the list cast of the codec's data type; under a type with no list cast it is `enum "<name>" member "<member>": Expected <forms>; got a list`.

The same code reports a written form this target has no data type for at all: `Expected <forms>; this target has no data type for a <string|boolean|number> value`, after `Field "<Model>.<field>"[ at element <n>]: ` in a `@default` — `true` on SQLite, for instance, which registers no boolean entry.

At a place that takes raw SQL, the receiving type is `sql/expression`, which casts from nothing, so every value other than a `sql` literal is refused and the message has no prefix. A quoted string gets the exact rewrite, ``Expected sql`...`; write sql`(archived_at IS NULL)` ``, unless the string's text would read back from a `sql` literal as different text (it has indentation shared by every line, blank lines at the start or end, a whitespace-only line, or a carriage return); then the message is ``Expected sql`...` `` alone. A number or a boolean reads ``Expected sql`...` `` too. See [ADR 268](../architecture%20docs/adrs/ADR%20268%20-%20Raw%20SQL%20is%20a%20value%20of%20the%20data%20type%20sql-expression.md).

The same code reports a literal default on a field typed by a composite type that does not have the composite type's shape. The path starts at `<Model>.<field>` and names each member with `.<member>` and each list element with `[<index>]`; `<kind>` is `a JSON object`, `a JSON array`, `a JSON string`, `a JSON number`, `a JSON boolean` or `null`:

- `Field "<Model>.<field>": the default of a value object is a JSON object, not <kind>`, and `the default of a list of value objects is a JSON array, not <kind>`. JSON `null` is taken when the field is optional.
- `Field "<path>": a value of "<Type>" is a JSON object, not <kind>`, for an element of a list or a nested member.
- `Field "<path>": "<key>" is not a member of "<Type>"`.
- `Field "<path>": the member is required, and the default has no value for it`.
- `Field "<path>": the member is not optional, so its value is not null`, and `an element of the member is not null` for a list member. A member typed by the stack's JSON type takes `null` as a value.
- `Field "<path>": the member is a list, so its value is a JSON array, not <kind>`.

A member value its codec refuses, or a value outside an enum member's enum, is `PSL_INVALID_DEFAULT_LITERAL`.

Reported at the written value, or at the list element the message names; a value that does not have the composite type's shape is reported at the `@default` attribute. See [ADR 254](../architecture%20docs/adrs/ADR%20254%20-%20Data%20types%20and%20casts.md).

### PSL_INVALID_LITERAL

A written value that the authoring entry's parse or a cast refused: a magnitude no double holds written on a `Float` column, a text a tag's parse cannot read, such as the text of a `json` literal that is not a JSON document, or a number no data type of the target holds — `no data type of this target holds the number <text>`, which is how SQLite refuses a whole number past 64 bits. The message is `Field "<Model>.<field>": <the message of whatever refused it>`, with ` at element <n>` after the field path when it is one element of a written list. At an argument typed by a data type, such as a place that takes raw SQL, the message has no prefix. Reported at the written value, or at the list element the message names. See [ADR 254](../architecture%20docs/adrs/ADR%20254%20-%20Data%20types%20and%20casts.md).

### PSL_VALUE_REFUSED

A written `enum` member or `@@base` value whose type the receiving codec's data type takes, but that the data type, under the codec's type parameters, or the codec refuses, in SQL and MongoDB schemas: `enum "<name>" member "<member>": <the message of whatever refused it>` for a member, with ` at element <n>` after the member when it is one element of a written list, and `Field "<Model>.<field>": <the message>` for a `@@base` value read into the discriminator field, such as one longer than a `VarChar(5)` discriminator holds. A value the authoring entry's parse or a cast refused is `PSL_INVALID_LITERAL`, and a value of a type the data type neither is nor casts from is `PSL_VALUE_TYPE_INCOMPATIBLE`. Reported at the member or the value. See [ADR 254](../architecture%20docs/adrs/ADR%20254%20-%20Data%20types%20and%20casts.md).

### PSL_DEFAULT_LIST_EXPECTED

A single value is written as the `@default` of a column that holds a list: `Field "<Model>.<field>": this column holds a list, so its default is a list literal, as in [1, 2]`. Every other mismatch between a written value and a column's type is `PSL_VALUE_TYPE_INCOMPATIBLE`. Reported at the `@default` attribute.

### PSL_INVALID_DEFAULT_LITERAL

A written `@default` value that the column's codec refused, such as a `pgvector.Vector(3)` column given two elements. The message is `Field "<Model>.<field>": <the codec's message>`, with ` at element <n>` after the field path when it is one element of a written list. A value the authoring entry's parse or a cast refused is `PSL_INVALID_LITERAL`. The same code reports a member value of a value-object default that the member's codec does not read, as in `Field "User.home.price": pg/numeric@1 JSON value must be a decimal string`; the default holds each member in the form its codec stores, so a `Decimal` or `BigInt` member takes a decimal string, and a `String` member a JSON string. It also reports a value of a member typed by an enum that is not one of the enum's values: `Field "<path>": Expected one of: <values>`, each value as its codec stores it, JSON-encoded. Reported at the `@default` attribute. See [ADR 254](../architecture%20docs/adrs/ADR%20254%20-%20Data%20types%20and%20casts.md).

### PSL_TAGGED_LITERAL_NUL

A tagged literal's body contains a NUL character: `Tagged literals must not contain NUL characters.` Reported at the literal, at every place that takes a tagged literal.

### PSL_TAGGED_LITERAL_TOO_LARGE

A tagged literal's text, which is its body after canonicalization, is larger than 65536 UTF-8 bytes: `Tagged literal exceeds 65536 bytes.` Reported at the literal, at every place that takes a tagged literal.

### PSL_LIST_AUTOINCREMENT_UNSUPPORTED

A list column declares `@default(autoincrement())`: `Field "<Model>.<field>" is a list and cannot use autoincrement(); it is a Prisma marker for a sequence-backed scalar column, not SQL.` Every other storage default lowers on a list column. Reported at the attribute.

### PSL_INVALID_DEFAULT_SQL

A `` @default(sql`...`) `` text fails the check `@default` runs on raw SQL: `Default SQL must not contain semicolons, SQL comment tokens, dollar-quoting, or subqueries.` (the rule the migration planners apply at DDL time, run at authoring time so it has a source span), or is exactly `now()` or `autoincrement()`: `` Write @default(now()) instead of sql`now()`; now() is a Prisma default function, not raw SQL. `` The tag is always `sql`. Only `@default` reports this code; the other places that take a `sql` literal check nothing about its text. Reported at the literal.

### PSL_INVALID_GENERATOR_ARGUMENT

An argument of a generator function in `@onCreate(...)` or `@onUpdate(...)` is a value of the target's integer type that the function does not take: `uuid: version must be 4 or 7, got <n>`, `cuid: version must be 2, got <n>`, or `nanoid: size must be between 2 and 255, got <n>`. Each argument is read like a written default of the integer type (`pg/int4` on Postgres, `sqlite/integer` on SQLite) before the function checks it, so a value that type does not take, such as `nanoid(8.5)` or `nanoid("8")`, is `PSL_VALUE_TYPE_INCOMPATIBLE` instead. A missing or extra argument is `PSL_INVALID_ATTRIBUTE_SYNTAX`, as in `Generator function "cuid" is missing required argument "version"`. Reported at the argument. See [ADR 254](../architecture%20docs/adrs/ADR%20254%20-%20Data%20types%20and%20casts.md) and [ADR 275](../architecture%20docs/adrs/ADR%20275%20-%20Client%20generators%20are%20field%20attributes%2C%20and%20a%20type%20alias%20is%20expanded%20into%20each%20column.md).

### PSL_ENUM_TYPE_NEEDS_PARAMETERS

An `enum` block's `@@type` names a codec whose data type requires a parameter, which an enum block has no way to give: `enum "<Enum>" @@type codec "<codecId>" represents data type "<dataType>", which requires the parameter "<parameter>"; an enum block gives it none`. Reported by the SQL PSL reader at the `@@type` attribute. Choose a codec whose data type takes no required parameter, such as the target's text or integer codec.

### PSL_UNSUPPORTED_ENUM_MEMBER_ATTRIBUTE

An enum member carries an attribute, as in `USER @map("user")`: `enum "<Enum>": member "<member>" carries @<attribute>, but an enum member takes no attributes`. Reported by the SQL and Mongo PSL readers, once per attribute, at the attribute. Remove the attribute. To store a value other than the member's name, write it as the member's value, as in `USER = "user"`.

### PSL_UNSUPPORTED_COMPOSITE_TYPE_ATTRIBUTE

A composite type carries a block attribute, as in `@@map("addresses")` inside a `type` block: `Composite type "<Type>" uses attribute "@@<attribute>", which a composite type does not take`. An attribute on one of its members is `PSL_UNSUPPORTED_FIELD_ATTRIBUTE`: `Member "<member>" of composite type "<Type>" uses attribute "@<attribute>", which a composite type member does not take`. Reported by the SQL PSL reader, once per attribute, at the attribute. Remove the attribute. To give a value object a default, write it on the model field as a whole value, as in `` home Address @default(json`{"street": "x"}`) ``.

### PSL_GENERATOR_ON_VARIANT_FIELD

A Mongo field that generates a value, through `@onCreate(...)`, `@onUpdate(...)` or a type alias such as `temporal.CreatedAt`, is declared on a polymorphic variant model (one with `@@base`): `Generated value on variant "<Model>" field "<field>": execution defaults apply to every document in collection "<collection>", so declare them on the base model.` Execution defaults are keyed by collection and field, so a default on one variant would also fill that field on the base model and every sibling variant. Declare the field on the base model; variants inherit it. Reported at the field.

### PSL_GENERATOR_CONFLICT

Two Mongo models stored in the same collection generate different values for the same stored field, for example `@onCreate(now())` on one and `@onCreate(now()) @onUpdate(now())` on the other: `Generated value on "<Model>.<field>" sets different execution defaults than "<Other>.<field>" for field "<stored>" of collection "<collection>". Generate the same values on both models.` Execution defaults are keyed by collection and field, so the collection can have only one. Identical ones are merged. Reported at the second field.

### PSL_GENERATOR_IN_DEFAULT

`@default(...)` calls a function the client generates, such as `uuid()`, `cuid(2)`, `ulid()`, `nanoid()` or a generator function an extension contributes. `@default` sets a database default only: `Field "<Model>.<field>": uuid(7) is a value the client generates, and @default sets a database default only. Write @onCreate(uuid(7)) instead.` Write `@onCreate(<call>)`; the contract does not change. A Prisma 7 schema read with `prisma7Schema(...)` keeps `@default(uuid())`. Reported at the call, in SQL schemas.

### PSL_UNKNOWN_GENERATOR_FUNCTION

`@onCreate(...)` or `@onUpdate(...)` calls a function no component of the stack declares as a generator function: `Field "<Model>.<field>": unknown generator function "<name>". Functions that apply: <functions bound to the field's codec>.` Write one of the functions the message lists, or add the extension that contributes the function. Reported at the call, in SQL and Mongo schemas.

### PSL_GENERATOR_NOT_APPLICABLE

`@onCreate(...)` or `@onUpdate(...)` calls a generator function that does not fill the field's codec: `Field "<Model>.<field>": uuid() does not apply to codec "pg/bytea@1". No generator function applies to this codec.`, or `Functions that apply: <functions>.` when others do. A field typed by an enum or a value object has no codec a generator function fills. Also reported when the function refuses the call for the column, with its own reason, such as `Field "<Model>.<field>": nanoid(16) writes 16 characters, which does not fit a column of 10 characters.` for a `Char(10)` or `VarChar(10)` column. Reported at the call.

### PSL_LIST_EXECUTION_DEFAULT_UNSUPPORTED

A list field writes `@onCreate(...)` or `@onUpdate(...)`: `Field "<Model>.<field>" is a list and cannot use @onCreate(uuid()). Lists have no per-element generated values; remove @onCreate(...).` Reported at the attribute, in SQL and Mongo schemas. A list field typed by a type alias that generates a value is refused at the field: `Field "<Model>.<field>" is a list, and its type alias "<Alias>" generates a value. Lists have no per-element generated values; remove "[]" or type the field without the alias.`

### PSL_DUPLICATE_ATTRIBUTE

An attribute that may appear once is written twice. On a model: ``` `@@control` declared more than once on model "<Model>". ``` On a field, for `@onCreate(...)` or `@onUpdate(...)`: ``` `@onCreate` declared more than once on field "<Model>.<field>". ``` A field has one generator for each phase; remove one of the attributes. Reported at the second attribute, in SQL and Mongo schemas. A field typed by a type alias may not write `@default`, `@onCreate` or `@onUpdate` when its alias already sets it: `Field "<Model>.<field>" writes @onUpdate, which its type alias "UpdatedAt" already sets. Remove one of them.` The alias is a `types {}` declaration or a contributed alias such as `temporal.UpdatedAt`. Reported at the field's attribute. A field may add any attribute its alias does not set, including `@id` and `@unique`.

### PSL_UNSUPPORTED_NAMED_TYPE_ATTRIBUTE

A type alias in a `types {}` block carries an attribute a type alias does not take. A type alias may carry `@default`, `@onCreate` and `@onUpdate`; every field typed by it takes them. `@id` and `@unique` are refused with `Type alias "<Alias>" cannot carry @id. @id and @unique belong to a model's field, not to its type; write them on the field.` A `@db.*` attribute keeps its own migration message. Any other attribute is refused with `Type alias "<Alias>" uses unsupported attribute "<attribute>"`. In a Mongo schema, `@default` is refused too, because MongoDB has no database defaults: `Type alias "<Alias>" uses unsupported attribute "@default". Use @onCreate(now()) instead; MongoDB has no database defaults.` Reported at the attribute. The refused attribute is dropped and the alias is kept, so the fields typed by it are not refused as well.

### PSL_UNSUPPORTED_NAMED_TYPE_BASE

A type alias in a `types {}` block has no base, or its base is not a type constructor or a block such as an enum: `Type alias "<Alias>" references unsupported base type "<base>"`, or `Type alias "<Alias>" must declare a base type or constructor`. An alias may not name another alias, `B = A`, or a contributed alias, `X = temporal.UpdatedAt`, and the message says what to write instead: `Type alias "B" is written as the type alias "A", and a type alias cannot be written as another one. Write what "A" is written as instead: B = VarChar(8)`. For a chain of aliases it writes the type and attributes the chain stands for, and for a cycle it suggests nothing. For a contributed alias it writes the whole line when a type constructor of the stack gives the alias's type, `Type the fields temporal.UpdatedAt instead, or write: X = DateTime @onCreate(now()) @onUpdate(now())`, and otherwise names only the attributes. A call to a name that no component contributes as a type constructor, such as a removed field preset, as a base is `PSL_UNSUPPORTED_NAMED_TYPE_CONSTRUCTOR`: `Type alias "<Alias>" references unsupported constructor "<path>"`. Reported at the declaration.

### PSL_INVALID_ATTRIBUTE_ARGUMENT

An argument of an attribute or a type constructor is invalid. One case is a contributed type alias written with arguments, as in `temporal.CreatedAt(3)`: `temporal.CreatedAt is a type alias and takes no arguments.` Write it bare, `temporal.CreatedAt`, or write the type with the attributes, as in `TimestamptzTemporal(3) @onCreate(now())`. Reported at the call, in SQL and Mongo schemas. In a Mongo schema, a `types {}` alias written with arguments is `PSL_UNSUPPORTED_FIELD_TYPE`: `Field "<Model>.<field>" calls "<Alias>", which is a type alias, not a type constructor. Remove the arguments.`

The same code reports a discriminator the discriminator rule refuses, in SQL and Mongo schemas alike. At the `@@discriminator` attribute: `Discriminator field "<field>" on model "<Model>" must be required, but it is optional. Remove the "?"`, `... must hold one value, but it is a list. Remove the "[]"`, and `... must be text, such as String, but is "<type>"` for a field whose data type is not one of the stack's text data types; a field is text by its data type, so a type alias of `String` is a discriminator. At the `@@base` value, for a discriminator typed by an enum: `Model "<Variant>" declares @@base value "<value>", which is not a member of enum "<Enum>", the type of discriminator field "<Model>.<field>". Write one of: "<member>", ...`. A refused discriminator or value gets no second diagnostic about an orphaned `@@base` or `@@discriminator`, and neither does a `@@discriminator` or `@@base` attribute that does not parse, such as `@@discriminator(nope)` or `@@base(Asset, 1)`.

### PSL_UNSUPPORTED_FIELD_ATTRIBUTE

A field carries an attribute the schema's family does not take. For `@updatedAt`, which Prisma 8 PSL does not take, the message names the replacement: `Field "<Model>.<field>" uses unsupported attribute "@updatedAt". Use @onCreate(now()) @onUpdate(now()), or type the field temporal.UpdatedAt.` The hint is left out when the field already writes `@onUpdate`. Reported at the attribute, in SQL and Mongo schemas.

## ORM

### ORM.ACTIVITY_SOURCE_MISSING

A SQL ORM terminal method was called on a queryable without an activity source. Every terminal method runs as an `orm-call` activity started through the queryable's `[activitySource]` member, which the SQL runtime's runtimes, connections, transactions and activity handles carry. A custom queryable, or a wrapper that copies `query` and `execute` without that member, has none. Pass the ORM a queryable from the SQL runtime, or keep the member in the wrapper. Payload: `method`.

### ORM.AGGREGATE_OPERATION_RESERVED

A contributed aggregate operation carries a name a collection builder member already owns (`select`, `include`, `where`, `combine`, `aggregate`, …, or a collection instance field). Aggregate operations surface as reducer methods on the ORM collection, in one flat namespace with the query-builder members, so a same-named operation would shadow the member it collides with. Raised at ORM composition (`orm(...)`), where the collection surface is assembled. Rename the contributed operation. Payload: `operation`.

### ORM.AGGREGATE_PROJECTION_ONLY

An aggregate operation contributed from outside the closed SQL aggregate alphabet (`count`, `sum`, `avg`, `min`, `max`) was used in HAVING, ORDER BY, or another comparison position. Such an operation reaches SQL only through its descriptor's lowering hook, a rendering meant for the SELECT projection, where the value crosses the driver boundary. HAVING and ORDER BY compare the value inside the database, where that rendering would change SQL semantics (a textual rendering compares and sorts lexicographically), so the query builder refuses at authoring time. Project the aggregate in a select and filter or order on the projected value, or use an operation from the alphabet. Payload: `operation`.

### ORM.AGGREGATE_SELECTOR_INVALID

An `aggregate()` or `groupBy().aggregate()` selector is not a valid aggregation descriptor, or an aggregate function that requires a column/field (e.g. sum, avg) was given none. Thrown when the ORM client builds the aggregate query plan. Payload: `method`, `model`, `alias`, `fn`.

### ORM.AGGREGATE_SELECTOR_MISSING

`aggregate()` or `groupBy().aggregate()` was called with zero aggregation selectors; at least one is required. Payload: `method`, `model` (or `namespaceId`, `tableName`).

### ORM.AGGREGATE_UNSUPPORTED

An aggregate was invoked for an operation/input pair the composed target declares no descriptor for: an undeclared pair has no result identity to type or decode, so it is rejected before any SQL is built rather than executed into a driver-native value. Raised by ORM aggregate planning and decoding, and by the SQL-builder lane's aggregate functions; the typed surfaces already make such a call a type error, so reaching this at runtime means a dynamic or cast invocation. Payload: `operation`, plus `table`/`column`/`inputCodecId` where an input is involved. Contribute an aggregate descriptor for the pair, or aggregate an input the target declares.

### ORM.ARGUMENT_INVALID

A method argument on the ORM client, or on the `sql()` / Mongo query-builder DSLs, is malformed or missing a required part: a `null` where-arg, `upsert()` without conflict columns or without a create value for a conflict column, a custom collection given as an instance / for a nonexistent model in a client's `collections` option or `orm({ collections })`, invalid builder argument shapes, `$and`/`$or` with no expressions, a limit, offset or skip that is negative or not an integer, malformed lookup/group/update specs, a row-locking method (`forUpdate()`, `forNoKeyUpdate()`, `forShare()`, `forKeyShare()`) given both `nowait` and `skipLocked`, or a `variant()` call whose value is not a declared discriminator value of the receiver model, or on a model with no discriminator (SQL and Mongo ORMs; the payload adds `value` and `declaredValues`). The Mongo ORM also raises it when `mongoOrm()` is given `enums` without an accessor for an enum the contract declares (`argument: 'enums'`, `namespace`, `enum`), and when a write through `createMongoCollection()` finds no accessor for the field's enum (`argument: 'enums'`, `enum`); pass `buildMongoEnums(contract, context.codecs)`. For SQL, the limit/offset check runs in relational-core when the `SelectAst` is constructed, so every SQL lane and target raises it before any SQL is rendered. That check also refuses integers above `Number.MAX_SAFE_INTEGER`, and does not check a limit or offset bound as a parameter. Payload: `method`, `argument` (`limit` or `offset` for the SQL limit/offset check), `model`, `column`, `key`. The `sql()` builder also raises it when a table's `indexes` is read by a name that more than one of its indexes shares (payload: `namespaceId`, `tableName`, `index`). It also raises it when a query is built with a column of an alias that is not one of the query's sources, such as one from an index read from `table.as('other').indexes` (payload: `alias`, `column`, `sources`).

### ORM.CAPABILITY_MISSING

The requested operation requires a contract capability the contract does not declare: the `returning` capability needed for mutations that read back the affected row (payload `capability`, `action`); or, on the `sql()` builder or an ORM collection, the flag a gated method or option needs, such as `postgres.distinctOn` for `distinctOn()`, `sql.forUpdate`, `sql.forShare`, `postgres.forNoKeyUpdate` or `postgres.forKeyShare` for the four row-locking methods (`forUpdate()`, `forNoKeyUpdate()`, `forShare()`, `forKeyShare()`), and `sql.lockOf`, `sql.lockNowait` or `sql.lockSkipLocked` for their `of`, `nowait` and `skipLocked` options; the ORM's four row-locking methods also need `sql.lockOf`, because the ORM has no `of` option and always renders `OF` the model's table (payload `method`, `capability`). Raised by the ORM client and the `sql()` builder.

### ORM.COLUMN_UNKNOWN

A mutation payload or where-expression references a column that does not exist on the resolved table. Thrown while compiling the query plan or binding the where clause, by the ORM client and by the `sql()` builder DSL. Payload: `namespaceId`, `tableName`, `column`.

### ORM.CURSOR_VALUE_MISSING

Cursor pagination was requested but the cursor object lacks a value for one of the `orderBy` columns, so the position cannot be anchored. Payload: `column`.

### ORM.FIELD_IMMUTABLE

A Mongo mutation payload attempts to write `_id`, which is immutable. Thrown by the Mongo ORM client for create/update/upsert payloads. Payload: `field`.

### ORM.FIELD_UNKNOWN

A name the caller passed is not a field of the model, or of the variant the collection is narrowed to. The SQL ORM client never treats such a name as a column name, so a column no field maps cannot be read, written or filtered on. Raised by `where` shorthand and the `where`/`orderBy` callback accessor, relation filters, `select`, `distinct`, `distinctOn`, `groupBy`, `cursor`, aggregates and `having`, `create`/`update`/`upsert` data (including variant creates), `conflictOn`, and include nested selects and scalar reducers. The message is `Model "<model>" has no field "<name>"`. When the name is the column of a field of the model, the message adds `"<name>" is the column of field "<field>"; pass the field name.` and the payload carries that field as `fieldForColumn`. When the name is a column that no field maps on the model's table or on a table of another model in its hierarchy, the message adds `Table "<table>" has a column "<name>" that no field maps, so the ORM cannot read or write it.` A fragment applied to a collection whose model lacks a declared field, or whose field does not match the declaration, raises it too, with its own message. Payload: `model`, `field`, and `fieldForColumn` when the name is the column of a field. The MongoDB ORM raises it for a name passed to `where` (the object form and the fields of a filter expression), `select`, `orderBy`, a field operation, or `create`/`update`/`upsert` data that is not a field or embed relation of the model: it reads and writes documents only through the model's fields, so a stored name no field stores cannot be reached. When the name is the stored name of a field, the message adds `"<name>" is the stored name of field "<field>"; pass the field name.`, as for `_id` when the field is `id @map("_id")`, and the payload carries that field as `fieldForStoredName`.

### ORM.FILTER_UNSUPPORTED

A shorthand equality filter targets a field whose codec does not support equality comparisons (lacks the equality trait). Payload: `model`, `field`, `trait`.

### ORM.GROUP_BY_FIELD_MISSING

`groupBy()` was called with zero fields; at least one grouping field is required. Payload: `namespaceId`, `tableName`.

### ORM.HAVING_EXPRESSION_UNSUPPORTED

A `groupBy().having()` expression uses a kind the grouped-having compiler does not allow: `ParamRef`/`PreparedParamRef`, list values, non-aggregate expressions, or another unsupported comparable kind. Only aggregate metric expressions are supported. Payload: `kind`.

### ORM.INCLUDE_INVALID

An `include()` usage is structurally invalid: the refinement callback returned something that is not a collection, include-scalar selector, or `combine()` descriptor; a `combine()` branch is invalid or empty; or an include-only action was called outside an `include()` refinement callback. Payload: `relation`, `branch`, `action`.

### ORM.INCLUDE_UNSUPPORTED

The include is well-formed but not supported in this position: scalar aggregations or `combine()` on a to-one relation (SQL), or including an embed relation / compound reference (Mongo; only reference relations can be included). Payload: `relation`, `kind`, `model`.

### ORM.INTERCEPTED_RESULT_INVALID

An `intercept.onActivity` handler answered an `orm-call` activity with a value of the wrong shape for its terminal method: not an array for `all()`, `createAll()`, `updateAll()`, `deleteAll()` or `groupBy().aggregate()`; not an object for `create()`, `upsert()`, `firstOrThrow()` or `aggregate()`; neither an object nor `null` for `first()`, `update()` or `delete()`; or not a number for `createAndCount()`, `updateAndCount()` or `deleteAndCount()`. The SQL ORM ends the call `failed` and returns nothing. Payload: `method`.

### ORM.LOCK_INCOMPATIBLE

A row-locking method (`forUpdate()`, `forNoKeyUpdate()`, `forShare()`, `forKeyShare()`) was combined with something that cannot be locked. Raised by the SQL builder: at `build()` when the select also has `distinct`, `distinctOn`, `groupBy` or `having`, or an aggregate or window function in the projection; and when a locked select is turned into a subquery through `.as()` or passed where a subquery is expected. Raised by the ORM client: when a locked collection is compiled with `include()`, `distinct()` or `distinctOn()`; when a row-locking method is called inside an `include()` refinement callback, or when a collection compiled with `include()` has a lock anywhere in its included rows (`includeRefinement`); when `groupBy()` or `aggregate()` is called on a locked collection; and when a mutation terminal (`create`, `createAll`, `createAndCount`, `upsert`, `update`, `updateAll`, `updateAndCount`, `delete`, `deleteAll`, `deleteAndCount`) is called on a locked collection, which already locks the rows it changes. Payload: `conflict` (`distinct`, `distinctOn`, `groupBy`, `having`, `aggregate`, `subquery`, `include`, `includeRefinement` or `mutation`).

### ORM.MODEL_UNKNOWN

The Mongo ORM client was asked to operate on a model name that is not in the contract (collection compile, or a raw-pipeline root bound to an unknown model). Payload: `model`, `root`.

### ORM.MUTATION_DATA_MISSING

`create()` or `createAndCount()` was called with zero rows; at least one row of data is required. Payload: `method`, `namespaceId`, `tableName`.

### ORM.MUTATION_DEFAULTS_MISSING

`mongoOrm()` was built over a contract with execution defaults (fields such as `temporal.CreatedAt` that the ORM fills on write) without `mutationDefaults`, so those fields would never be written. Pass the execution context, `mongoOrm({ contract, executor, mutationDefaults: context })`, or create the client with `mongo()`. Payload: `fields` (`<collection>.<field>` for each default).

### ORM.MUTATION_ROW_MISSING

A mutation that expected the database to return a row got none: `create()`/`upsert()` read-back, MTI base or variant INSERT, or a nested create. The Prisma-classic analogue of P2025. Payload: `operation`, `model`, `tableName`, `phase`.

### ORM.OPERATION_UNSUPPORTED

A valid ORM method was called in a configuration that does not support it: mutating an MTI variant collection with a method that requires `createAll()`, passing `onConflict: 'skip'` to `createAll()` on an MTI variant collection, Mongo `upsert()` with dot-path field operations, a Mongo `upsert()` whose `create` sets a field that has an update default and whose update pulls by a match document (that upsert runs as one update pipeline, which can pull only a single value), a Mongo mutation carrying windowing (`orderBy`/`offset`/`limit`) or includes, or `variant()` called on a collection that already has a variant selected (SQL and Mongo ORMs; call it on the base collection instead; `reason: 'variant-already-selected'`, with `variant` and `selectedValue` naming the selected variant model and its discriminator value). Payload: `method`, `model`, `reason`, `field`.

### ORM.RELATION_LINK_DUPLICATE

A `connect()` nested mutation violated a unique constraint on the junction table: the junction link is likely already present. The original driver error is preserved as `cause`. Payload: `relation`, `junction`.

### ORM.RELATION_MUTATION_INVALID

A nested relation mutation's input is malformed: a relation field without a mutator callback or returning an invalid descriptor, `create` without data, `connect`/`disconnect` with a missing or empty criterion, duplicate connect criteria resolving to the same junction link, or conflicting values for a junction column. Payload: `kind`, `relation`, `model`, `problem`, `junction`, `column`.

### ORM.RELATION_MUTATION_UNSUPPORTED

A nested relation mutation kind is not supported in this position: `disconnect()` outside `update()` nested mutations, or `create()`/`connect()` through a junction table with required columns the relation API cannot populate (`disconnect()` stays available). Payload: `kind`, `relation`.

### ORM.RELATION_ROW_MISSING

A `connect()`/`disconnect()` nested mutation's criterion matched no row on the related model. Payload: `kind`, `relation`.

### ORM.RELATION_UNKNOWN

A referenced relation name does not exist on the model, in `include()` (SQL and Mongo) or when resolving relation metadata from the contract. Payload: `model`, `relation`.

### ORM.ROW_IDENTITY_MISSING

The operation needs a primary key or unique constraint the table does not have: `update()`/`delete()` targeting a single row, a `create()` or `update()` with nested relation mutations (which updates and reloads the row by that key), or keying the include read-back after a mutation. Payload: `model`, `table`.

### ORM.TABLE_UNKNOWN

The table a collection resolves to does not exist in the contract's storage for the namespace. Thrown during storage resolution or query planning. Payload: `namespaceId`, `tableName`.

### ORM.WHERE_MISSING

A Mongo mutation method (e.g. update/delete variants) requires a prior `.where()` filter and none was set. Payload: `method`.

## RUNTIME

### RUNTIME.ABORTED

An in-flight `query()` or `execute()` operation was cancelled via the per-operation `AbortSignal` passed as the call's `{ signal }` option. `details.phase` says where the abort was observed: `encode`, `decode`, `stream`, or the middleware phases `beforeEncode` / `onRow`; the envelope's `cause` carries `signal.reason` verbatim. Payload: `phase`.

### RUNTIME.ACTIVITY_ALREADY_ENDED

A client called `end()` a second time on an activity it started. The activity ended and was finalized at the first call; the second changes nothing. Payload: `kind`, `id`.

### RUNTIME.ACTIVITY_CHILDREN_OPEN

A client ended an activity it started with `startActivity` while a statement or an activity beneath it had not ended, such as a row stream it had not finished reading. The activity is ended `failed` and finalized before the error is raised; each open child is finalized when it ends. End or drain every child before calling `end()`. Payload: `kind`, `id`, `openChildren`.

### RUNTIME.ACTIVITY_KIND_RESERVED

A client started an activity with a kind that has no hyphen, such as `statement`, `transaction` or `report`. A client kind contains a hyphen, such as `orm-call`; kinds without one belong to the runtime. The types reject such a kind, so this happens only when a caller casts it. Payload: `kind`.

### RUNTIME.ACTIVITY_NOT_ACCEPTING_CHILDREN

A statement or an activity was started beneath an activity that no longer accepts children: a transaction whose `commit()` or `rollback()` has been called, which happens before the transaction ends, a client activity after its `end()`, or a client activity inside such a transaction. Through an activity handle, the work is refused before it takes a connection or a session. No middleware hook runs for the refused work. Start the work before ending or settling its parent, or on a queryable that is still open. Payload: `parentKind`, `parentId`.

### RUNTIME.ACTIVITY_OUTSIDE_TRANSACTION

A statement was sent through an activity handle opened on a connection after a transaction was opened on that connection. The statement would run inside the database transaction while its activity is outside it, so it would be reported committed before the transaction commits. Send the statement on the transaction, or start the activity on the transaction. Payload: `kind`, `id`, `transactionId`.

### RUNTIME.AGGREGATE_DESCRIPTOR_INVALID

A component contributed an aggregate descriptor whose shape the SQL aggregate registry cannot read: a missing or empty `operation`, an `input` that is not `none` / `any` / `codec` / `trait` (including an unknown trait name), an `output` that is not `self` / `codec`, a non-boolean `nullable`, a `nullable: false` descriptor with no `emptyResultWire`, a `self` output on an operation that consumes no input, or a non-callable `lower`. `emptyResultWire` is the value a non-nullable operation answers with when no result row reaches the caller, stated as the wire value the result codec's `fromWire` reads: `'0'` under both `pg/int8number@1` and `pg/int8@1`. Raised while the execution context assembles the registry. Payload: `descriptor`.

### RUNTIME.AGGREGATE_LOWERING_MISSING

An aggregate descriptor declares an operation outside the closed SQL aggregate alphabet (`count`, `sum`, `avg`, `min`, `max`) and carries no `lower` hook. An alphabet operation lowers to a plain aggregate call by default; renderers know no other operation, so any other name must build its expression through a lowering hook from existing AST nodes. Raised while the execution context assembles the aggregate registry. Payload: `operation`, `key`.

### RUNTIME.AGGREGATE_OUTPUT_CODEC_MISSING

An aggregate descriptor names a result codec the composed stack does not register, either its `output` names the codec outright, or a `self` output over an exact input match reuses an input codec the stack never composes. A resolved aggregate decodes its result through the declared codec, so an unregistered one could never decode anything. Raised while the execution context assembles the aggregate registry. Payload: `operation`, `key`, `outputCodecId`.

### RUNTIME.AMBIGUOUS_AGGREGATE_DESCRIPTOR

Two trait-matching aggregate descriptors for one operation both claim a registered codec: the codec advertises both traits, so the result codec is undetermined. Contribute an exact codec descriptor for that operation, or narrow the overlapping trait contributions. Raised while the execution context assembles the aggregate registry, so it never surfaces mid-query. Payload: `operation`, `codecId`, `traits`.

### RUNTIME.ANNOTATION_INAPPLICABLE

A lane terminal (SQL DSL `.build()`, ORM collection terminal) received an annotation whose declared `applicableTo` set does not include the operation kind being built: the runtime check that backs up the type-level annotation validation when it is bypassed via casts or dynamic invocation. Remove the annotation from that operation and put it on an operation of a kind its `applicableTo` names; the message names those kinds. Payload: `namespace`, `terminalName`, `kind`, `applicableTo`.

### RUNTIME.ARGUMENT_INVALID

A built-in Postgres query operation or full-text helper received an argument it cannot use, `postgres()` or `postgresServerless()` received a `cursor` option it cannot use, or `createInMemoryCacheStore` received a size or lifetime it cannot use. Five cases: (1) the `language` of `fullTextMatches`, `fullTextRank` and `fullTextHeadline`, of the `tsquery` parsers (`websearchToTsquery`, `toTsquery`, `plaintoTsquery`, `phrasetoTsquery`) and of the `tsquery` template tag is written into the SQL as an inline literal rather than a bound parameter, so it is checked against the text-search configurations a stock PostgreSQL server ships with and anything else is refused, while the query is being built; (2) a literal part of a `tsquery` template has an invalid JavaScript escape, such as `\u`, so JavaScript gives the tag no text for that part and the tag refuses it rather than drop it, also while the query is being built; (3) the `cursor` option has a key other than `batchSize` (including the driver's own `disabled` setting) or a `batchSize` that is not a positive integer, raised at the factory call; leave `cursor` unset to read without a cursor. (4) `createInMemoryCacheStore` from the cache middleware received a `maxEntries` that is not a positive integer, or a `ttlMs` that is not a positive number (`Infinity` means never expire), raised at the factory call; (5) the document given to `fullTextMatches` or `fullTextRank` is not a full-text index, a column or a `fullTextDocument` (such as weight groups passed as a bare array, or an index of another type), is a full-text index given together with a `language` option, which the index states itself, or is a full-text index whose options are not a full-text definition, or the weight groups given to `fullTextDocument` are not one to four non-empty groups, raised while the query is being built. Payload: `helper` (the operation, or `postgres` / `postgresServerless` for the factory option, `createInMemoryCacheStore` for the cache store), `argument`, `received`, plus `extension: 'postgres'` for the factory option. The MySQL runtime driver raises it when MySQL refuses a value for a placeholder it reads as an integer, such as a `LIMIT` or `OFFSET` value that is not an integer (MySQL error 1210); the MySQL error is attached as `cause`, with `sql` in the payload.

### RUNTIME.AST_INVALID

A lowered SQL AST is structurally invalid: a subquery projecting other than one column, an INSERT with zero rows, a missing column value, an empty onConflict column list or do-update-set, an UPDATE with no SET assignments, an INSERT target table absent from contract storage, or an AST node constructed with invalid arguments (empty FunctionSource column aliases, a CaseExpr with no branches, a raw query declaring a `__proto__` result column, a name that cannot survive as a column, so alias it in SQL and declare the alias). Raised by the Postgres and SQLite SQL renderers and by AST node construction in relational-core. The MySQL drivers raise it for a parameter value MySQL has no parameter type for, such as an object, an array or a non-finite number, with `target: 'mysql'`, `index` and `valueType`. The MySQL adapter and drivers raise it for SQL text containing an executable `/*!` comment, whose content MySQL runs as SQL: the adapter when it reads raw SQL to find the operands of `LIMIT` and `OFFSET`, the drivers when they find a statement's placeholders. Payload: `node`, `table`, `column`; construction sites carry node-specific fields.

### RUNTIME.AST_UNSUPPORTED

The authored SQL AST uses a feature this target cannot render, e.g. DEFAULT as a value in INSERT … VALUES, WITH ORDINALITY on function sources, or returned-column aliases on function sources, all on SQLite; a row-locking clause (`FOR UPDATE` and the like) on SQLite, which has no row locks and refuses the clause rather than drop it; or a row-locking clause whose strength or option (`of`, `nowait`, `skipLocked`) needs a capability the Postgres adapter did not report. The MySQL target raises it for a FULL or LATERAL join, a function source, a row-locking clause, DISTINCT ON, a non-finite number literal, a text, date, array or object literal (`feature: 'value-literal'`), which only a caller could supply and which must be a param, a write (insert, update, delete), a raw column inside an `include`, and query lowering on its control adapter, which MySQL does not build yet; the payload is `target: 'mysql'` and `feature`. Raised by the target adapters' renderers. Payload: `node` (INSERT DEFAULT site); `target`, `feature` (function-source sites, and locking-clause sites with `feature: 'locking-clause'`); on Postgres locking-clause sites also `capability`, the missing flag.

### RUNTIME.BINDING_INVALID

A client (`postgres()`, `sqlite()`, `mongo()`) received a connection binding whose shape is wrong for the target: malformed connection string, unsupported binding kind, or missing required fields. Raised at `connect(...)` / client construction. The MySQL drivers raise it for a URL parameter they do not read (they read `ssl`, `connectTimeout`, `flags`, `connectionLimit`, `poolTimeout` and `statementCacheSize`, which must be at most 1,000), for a `charset` parameter, because they always connect as utf8mb4, or for a pool setting that is not a positive integer. A serverless Postgres client raises it from `connect({ url })` for an empty URL, a string that is not a URL, or a scheme other than `postgres://` or `postgresql://`, before any `pg.Client` exists. Payload: `received`, `reason`.

### RUNTIME.BINDING_MISSING

A client (`postgres()`, `sqlite()`, `mongo()`) was asked to connect with no binding at all (no connection string, no environment fallback). Payload: `expected`.

### RUNTIME.CACHE_STORE_META_UNSUPPORTED

The default in-memory cache store was asked to remove entries by `meta`, through `invalidate({ meta })` or a write annotated with `invalidateAnnotation({ meta })` on a cache middleware that uses it. That store ignores `meta` when it stores an entry, so it cannot tell which entries match. The call removes nothing, including the keys passed with it. From `invalidate` the error rejects the call; from an annotated write it goes only to the client's `log` as `middleware.activityFinalized.error`, and the write keeps its own outcome. Use a `CacheStore` that indexes `meta` in `set` and honours it in `unset`, or pass only `keys`.

### RUNTIME.CODEC_DESCRIPTOR_ARRAY_UNSUPPORTED

A codec projection used `CodecRef.many` against a SQLite codec descriptor: SQLite has no stored scalar-array codec protocol, so projecting the whole stored array would be ambiguous. Use a scalar CodecRef or an explicit target representation. Payload: `codecId`.

### RUNTIME.CODEC_DESCRIPTOR_INVALID

A codec descriptor handed to a target codec-descriptor registry (Postgres, SQLite) is not a valid descriptor for that target: wrong discriminant, missing target descriptor methods, a Postgres descriptor whose `jsonType` is not a JSON type, or a malformed params schema. Extend the target's descriptor class or adapt a generic descriptor with the target's wrapper (`postgresCodec()` / `sqliteCodec()`). Payload: `codecId`.

### RUNTIME.CODEC_DESCRIPTOR_MISSING

A column, a domain enum, or an AST-carried CodecRef references a `codecId` for which no runtime component registered a codec descriptor: usually the extension pack that owns the codec is missing from the runtime stack. Surfaces at SQL context construction during the contract codec walk, when a SQL or Mongo client builds `db.enums` (for Mongo, in `buildMongoEnums`, which also builds the accessors `mongoOrm()` takes), or lazily when the AST codec resolver materializes a codec at query time. Payload: `codecId`; on the column path also `table`, `column`.

### RUNTIME.CODEC_MISSING

Runtime validation of the contract found columns whose `codecId` has no implementation in the codec registry; the error lists every affected column. Surfaces when the codec registry's completeness is validated at context/runtime setup. Payload: `contractTarget`, `invalidCodecs` (list of `{ namespaceId, table, column, codecId }`).

### RUNTIME.CODEC_PARAMETERIZATION_MISMATCH

A column's codec reference disagrees with the codec's parameterization: a parameterized codec is used with no `typeParams` (and its schema requires some), or `typeParams` are supplied to a non-parameterized codec. Surfaces during the SQL context's contract codec walk. Payload: `table`, `column`, `codecId`, `expected`, `actual`.

### RUNTIME.CONTENT_HASH_REQUIRES_RESOLVED_COMMAND

Mongo middleware called `ctx.contentHash(plan)` (or `computeMongoContentHash`) during `beforeEncode`, when `plan.command` is still an unresolved lowered draft rather than a resolved wire command. Compute the hash in `intercept.onQuery` or `intercept.onExecute`, where the plan is resolved, or use the param mutator instead of reading `plan.command` structurally. Payload: `phase`.

### RUNTIME.CONTRACT_FAMILY_MISMATCH

At SQL context construction, the contract's target family (e.g. `mongo`) does not match the runtime stack's family (`sql`): the contract was emitted for a different database family than the stack being assembled. Payload: `actual`, `expected`.

### RUNTIME.CONTRACT_TARGET_MISMATCH

At SQL context construction, the contract's target (e.g. `sqlite`) does not match the runtime stack's target descriptor (e.g. `postgres`): the contract and the adapter/driver stack disagree about the database target. Payload: `actual`, `expected`.

### RUNTIME.DATE_STYLE_NOT_ISO

A PostgreSQL date and time codec that reads a date or timestamp (`pg/date-string@1`, `pg/date-temporal@1`, `pg/timestamp-string@1`, `pg/timestamp-temporal@1`, `pg/timestamptz-string@1`, `pg/timestamptz-temporal@1`, `pg/timestamptz-date@1`) read a value PostgreSQL printed under a `DateStyle` other than `ISO`, such as `02.01.2026` under `German`: the driver could not ensure the `DateStyle=ISO` the PostgreSQL target requires. The driver starts each connection it opens with `DateStyle=ISO` as a startup option, and sets it with a statement on a connection of a `pg.Pool` or `pg.Client` the application supplies before first use and after an exclusive use ends. So a statement in the application set a `DateStyle` other than `ISO` on a connection Prisma uses, or a connection pooler dropped the startup option (PgBouncer does when `ignore_startup_parameters` lists `options`) or runs each statement on another server connection. Do not set a `DateStyle` other than `ISO` on a connection Prisma uses. Behind a pooler that refuses startup options, pass Prisma your own `pg.Pool`; behind one that moves statements between server connections, set `DateStyle` to `ISO` on the role or database. `time` and `timetz` print the same text in every `DateStyle`. On a flat read the envelope surfaces as it is; on an `.include()` read it is the `cause` of a `RUNTIME.DECODE_FAILED`. Payload: `codecId`, `received` (the text, cut to 100 characters).

### RUNTIME.DDL_UNSUPPORTED

`lower()` was asked to lower DDL on a surface that cannot do it: the runtime adapter (DDL lowering is a control-plane concern), or the synchronous control lowering path (DDL default literals require async codec encoding; use `lowerToExecuteRequest()`). Raised by the Postgres and SQLite adapters. Payload: `surface`.

### RUNTIME.DECODE_FAILED

A codec's `fromWire` threw while converting a wire value into its output type during result decoding, surfaces per column (SQL), per document field (Mongo), or per included-relation column (ORM client), with the original error attached as `cause`. Also thrown when a returned row is missing an expected projection alias, or when the JSON array for an include alias fails to parse. Payload: `table`, `column` (or `alias` / `collection` + `path`), `codec`, `wirePreview`. When a Mongo codec raised the code itself, its own details (for the target's codecs, `codecId` and `received`) are kept alongside. An `InternalError` from a codec is a bug in Prisma, not a bad stored value, so it is not wrapped and surfaces unchanged. On Mongo the message also names the document it read, `Failed to decode field <path> of the document with _id <id> in collection '<collection>' …`, with the id (an `ObjectId` as hex, a string quoted) in `documentId`; for a document an insert returns, `<path>` starts at that document and the id is its `_id`; `wirePreview` is the JSON text of the stored value, each BSON class in its own JSON form, cut at 100 characters.

Codecs and data types also raise this code directly, as a structured envelope with `meta.codecId` or `meta.dataType` and `meta.received`, the value as JSON text cut to 100 characters. The integer guards: `pg/int8number@1` and `sqlite/bigintnumber@1` (the `BigIntNumber` type), and `mongo/int64Number@1` (the `Int64Number` type), refuse a value outside the safe integer range ±(2^53 − 1) and any non-integral value rather than rounding it, as in `pg/int8number@1 JSON value must be a decimal integer string from -9007199254740991 to 9007199254740991`; on a stored fractional double, `mongo/int64@1` and `mongo/int64Number@1` say how to rewrite it as a long; `pg/int8@1`, `pg/unboundedint@1`, and `sqlite/bigint@1` refuse a wire value that is not a decimal integer. A data type reads every value a contract stores, in a default or an enum member, and refuses one it does not hold, including one its parameters rule out, with the message `<data type> JSON value must be <what it takes>`, as in `pg/text JSON value must be a string`, `pg/int4 JSON value must be an integer from -2147483648 to 2147483647`, or `pgvector/vector JSON value must be an array of 3 finite numbers`. A value in another spelling than the one the type stores is refused with the text to write: a type that stores an integer as digit text refuses a leading zero or a minus sign on zero, as in `pg/int8 JSON value must be "7", the integer's decimal text without leading zeros or a minus sign on zero`; `pg/numeric` refuses a numeral PostgreSQL prints differently (`pg/numeric JSON value must be "1.5", as PostgreSQL writes this value`) and, under a scale, a value in another spelling (`pg/numeric JSON value must be "1.50", the spelling its parameters give this value`); and `pg/uuid` and `pg/inet` refuse a value PostgreSQL prints differently. A float type takes a finite number or the text `NaN`, `Infinity` or `-Infinity`, which PostgreSQL writes for those values. On SQLite, `sqlite/real@1` and `sql/float@1` refuse `NaN`, which SQLite stores as NULL: their `fromDataTypeValue` raises this code for the text `"NaN"`, and their `toWire` and `toDataTypeValue` raise `RUNTIME.ENCODE_FAILED`, so a `.default(NaN)` fails when the contract is built. `fromWire` refuses a value its column's type does not hold: on SQLite, `<codecId> wire value must be an integer or its decimal text` for text or bytes in an `INTEGER` column, `<codecId> wire value must be a number, or the text Infinity or -Infinity` for a `REAL` column, and `sqlite/blob@1 wire value must be bytes, or the array of their hex text an include carries` for text or a number in a `BLOB` column; on PostgreSQL, `pg/text-array@1 reads a one-dimensional text[], and {{a},{b}} has more dimensions`. Both PSL readers, SQL and MongoDB, read each `enum` member by the cast rule, then check it with the codec: a member whose written form the codec's data type does not take is reported as `PSL_VALUE_TYPE_INCOMPATIBLE`, worded as that section describes, a member an authoring entry or a cast refuses as `PSL_INVALID_LITERAL`, and a member the data type or codec refuses as `PSL_VALUE_REFUSED`, with their message. A number member is read from its source text, so `A = 9007199254740993` under `pg/int8@1` keeps every digit. In both families a member written without a value under a codec that does not take text is `PSL_ENUM_BARE_MEMBER_NON_STRING_CODEC`. A row and an `.include()` are read with the same `fromWire`; on a flat read the codec's envelope surfaces unchanged, and on an `.include()` read the ORM client wraps it in a fresh `RUNTIME.DECODE_FAILED` carrying `table`, `column`, and `codec`, with the codec's envelope on `cause`. One SQLite caveat: on a flat read, `node:sqlite` itself refuses an INTEGER outside the safe range before any codec runs, so for an out-of-band stored value the structured envelope is guaranteed on the include path, not the flat path.

On Mongo, `mongo/json@1` (a `Json` field) raises this code when the stored value is not JSON at some depth: `mongo/json@1 wire value contains a non-JSON BSON <type> at <path>`, where `<type>` is the BSON `$type` alias (`date`, `objectId`, `decimal`, `binData`, `regex`, `timestamp`, `long` for one outside the safe-integer range, `undefined`, `symbol`, `javascript`, `minKey`, `maxKey`, or the constructor name of an object the driver does not produce) and `<path>` is the dot-notation path inside the field, with array indices as segments, or `the root`. A stored `NaN`, `Infinity` or `-Infinity` is named as such: `mongo/json@1 wire value contains NaN at <path>; a JSON number cannot be NaN or Infinity`, with `meta.received` set to that value. A subdocument with `$ref` and `$id`, which the driver reads as a `DBRef`, decodes back to the document it was stored as, each member checked at its own path (`link.$id`). A stored subdocument that merely has a `_bsontype` key is read as that document, not as the type it names. The codec's envelope carries `meta.codecId`, `meta.received` (the BSON type) and `meta.valuePath` (the path inside the field); the runtime's wrapper copies them into its `details` beside `collection` and `path`, the field's own path in the document. A `long` in the safe-integer range and the driver's `Int32` and `Double` wrappers decode as numbers. Such a field should be `Bson`, which admits any BSON value.

**Aggregates reach the same guards.** `count()` and `sum()` over integers declare a number-flavoured result codec, so a tally or total past ±(2^53 − 1) raises this code: `pg/int8number@1 value must be an integer within the safe integer range, got 9007199254740992`, instead of returning a rounded value. It fires on the wire path and on the `.include()` path alike: the include projection is a JSON number, but the guard runs after `JSON.parse`, and rounding is monotone, so a value that was outside the range is still outside it. Where the magnitude is real rather than a bug, switch that call to the lossless variant beside it: `countBigInt()`, `sumBigInt()`, or `avgDecimal()`.

### RUNTIME.DUPLICATE_AGGREGATE_DESCRIPTOR

Two components claim the same aggregate overload: the same `(operation, input)` pair, keyed as `sum:trait:numeric`, `sum:codec:pg/int8@1`, or `count:none`. Each overload resolves to exactly one result codec, so exactly one target, adapter, or extension may contribute it. Payload: `key`.

### RUNTIME.DUPLICATE_AUTHORING_DISCRIMINATOR

Two authoring contributions register the same discriminator key, the same `entityType` key or the same `pslBlock` parser keyword, when the framework authoring surface assembles its descriptor registry. Each contribution must use a unique key. Payload: `label`, `key`, `existingPath`, `path`.

### RUNTIME.DUPLICATE_CODEC

Two runtime stack contributors (target pack, extension packs) register a codec with the same id, while the SQL context or Mongo execution stack collects codecs, or while a target codec-descriptor registry (Postgres, SQLite) is composed. Remove the duplicate contribution. Payload: `codecId`; on the Mongo path also `existingOwner`, `incomingOwner`; on the target registry path also `target`.

### RUNTIME.DUPLICATE_MUTATION_DEFAULT_GENERATOR

Two runtime stack contributors register a mutation default generator with the same id while the SQL context or the Mongo execution context collects them. Payload: `id`, `existingOwner`, `incomingOwner`.

### RUNTIME.ENCODE_FAILED

A codec's `toWire` threw while converting a user-supplied parameter value to driver wire format during query execution (SQL param encoding, or Mongo param-ref resolution), with the original error attached as `cause`. Payload: `label`, `codec`; SQL path also `paramIndex`. On Mongo, a value written through the ORM is labelled with its field path, the payload adds `collection`, and the message reads `Failed to encode field <path> in collection '<collection>' with codec '<id>': …`. When a Mongo codec raised the code itself, its own details (for the target's codecs, `codecId` and `received`) are kept alongside. An `InternalError` from a codec is a bug in Prisma, not a bad value, so it is not wrapped and surfaces unchanged.

Codecs also raise this code directly, as a structured envelope with `meta.codecId` and `meta.received`, which surfaces unchanged: writing a value outside ±(2^53 − 1), or a non-integral number, through `pg/int8number@1` or `sqlite/bigintnumber@1` (the `BigIntNumber` type) raises it before any SQL executes, and through `mongo/int64Number@1` (the `Int64Number` type) before any command is sent.

On SQLite, which cannot store NaN and binds it as NULL, NaN raises this code. `sqlite/real@1` and `sql/float@1` refuse it in `toWire`, for a value written to a column or used as a filter value, and in `toDataTypeValue`, for a TypeScript `.default()`: `<codecId> value must be a number other than NaN, which SQLite cannot store`. The SQLite driver refuses a NaN parameter no codec encoded, such as one in raw SQL: `Parameter <n> is NaN, which SQLite cannot store: it would bind it as NULL. Pass null to store no value.` Both carry `meta.received: 'NaN'`; `meta.codecId` is present when a codec refused the value, and `meta.paramIndex`, counted from 0, when the driver did. Pass `null` for no value.

On Mongo, `mongo/json@1` (a `Json` field) raises this code for any value that is not a plain JSON value at some depth: `mongo/json@1 value must be a JSON value; received <kind> at <path>`. `<kind>` is the `_bsontype` tag of a BSON value (`ObjectId`, `Long`, `Decimal128`, `Binary`, …), `Date`, `bigint`, `symbol`, `function`, `undefined`, `NaN`, `Infinity`, `-Infinity`, `sparse array hole`, `circular reference`, or the constructor name of any other non-plain object (`Map`, `Uint8Array`, a class name); `<path>` is the dot-notation path inside the value, or `the root`. The message ends with how to store the value instead, worded for its kind: a `Date` as an ISO 8601 string, a `bigint` or `Long` as a safe-integer number or decimal text, an `ObjectId` as its hex string, bytes as base64 text, or, for any BSON value, by declaring the field `Bson`. The codec's envelope carries `meta.codecId`, `meta.received` (the kind) and `meta.valuePath` (the path inside the value); the runtime's wrapper copies them into its `details` beside `label`, `collection` and `codec`. `mongo/bson@1` (a `Bson` field) raises the same shape, `mongo/bson@1 value must be a BSON value; received <kind> at <path>`, for `undefined`, `bigint`, `symbol`, a function, a `DBRef` instance (the message ends `Write it as a { $ref, $id } document instead.`), a sparse-array hole, a circular reference, an object carrying a `_bsontype` the driver's `bson` did not create (`<tag> not created by bson 7`: a literal look-alike such as `{ _bsontype: 'MinKey' }`, or a value from another major version of `bson`), or a non-plain object other than a `Date`, native `RegExp` or `Uint8Array` (`Map`, `Set`, a class instance, another typed array).

The Mongo codecs refuse a value of the wrong type with this code, a list element included, so it is not stored: `mongo/string@1 value must be a string; received <value>`, and the same for `mongo/bool@1` (a boolean), `mongo/date@1` (a valid Date; an invalid `Date` would be stored as the epoch), `mongo/objectId@1` (a 24-digit hex string or an ObjectId; `null` would otherwise become a new id and a number a timestamp), `mongo/vector@1` (an array of numbers), `mongo/int32@1`, `mongo/int64Number@1` (an integer from -9007199254740991 to 9007199254740991) and `mongo/double@1`. `<value>` is a number, a `bigint` written with its `n` suffix (`9n`), a quoted string, `null`, `an array`, `a Date`, `an invalid Date`, or the value's JavaScript type; for an object tagged as an `ObjectId` whose `toHexString()` is missing or does not return 24 hex digits, it is `an object tagged ObjectId whose toHexString() does not return 24 hex digits`. An `ObjectId` from any major version of `bson` is accepted and rebuilt from its hex string.

The Mongo ORM also raises this code, before anything reaches the driver, for two values that a contract without a collection validator (read from a Prisma 6 schema) would store. Both apply to values written by `create`, `update` and `upsert`; a filter may compare a field with either, to find documents that already hold one.

- A value outside a field's enum: `Failed to encode field <path> in collection '<collection>': "<value>" is not a value of enum <Enum>; the values are "<a>" and "<b>"`, with `label`, `collection`, `received` and `allowed` in `details`.
- `null` for a field that is not nullable: `Failed to encode field <path> in collection '<collection>': the field is required and cannot be null`, with `label` and `collection` in `details`. `null` for a nullable field is written as `null` without calling the field's codec.

The SQL integer codecs also check the JS type of the value they are given, and report that separately from the range: `pg/int8number@1` and `sqlite/bigintnumber@1` read a `number`, while `pg/int8@1`, `pg/unboundedint@1`, and `sqlite/bigint@1` read a `bigint`. A value of the other type raises `<codec> value must be a <number|bigint>, got <type> <value>` with `meta.received` naming the type that arrived: the message you get from passing `9n` where a `number` is read, rather than a range complaint about a value plainly inside the range. `mongo/int64Number@1` reports both in one message, as the other Mongo codecs do, and the suffix shows the type: `value must be an integer from -9007199254740991 to 9007199254740991; received 9n`.

The exact integer codecs make one exception, and only for a stored value. `toDataTypeValue` on `pg/int8@1`, `pg/unboundedint@1`, and `sqlite/bigint@1` also accepts a `number`, because a schema language writes no `bigint` literal. The number must be an integer within the safe range, and a value that is not raises `<codec> number literal must be an integer within the safe integer range, got <value>`: a `number` past that range was already rounded before the codec saw it, so its digits no longer name the value that was written. The PSL interpreter therefore does not hand these codecs a rounded number: it reads a number `@default` from its source text, gives the codec the plain number when that reads, and the decimal text of the literal when it does not, so `BigInt @default(0)` still arrives as the JSON number `0` while `BigInt @default(9007199254739999999)` arrives as its digits. `toWire`, the path a query parameter travels, takes no such number; it requires the `bigint`.

### RUNTIME.EXECUTION_RESULT_MISSING

A statistics execution completed without returning statement statistics. This indicates a runtime or middleware implementation violated the execution contract instead of returning `{ affectedRows }`. Payload: none.

### RUNTIME.ITERATOR_CONSUMED

An `AsyncIterableResult` (the return value of `query()`) was iterated a second time: each result can be consumed only once, whether via a `for await` loop or via `toArray()`/`await`. Store the array from `toArray()` if you need to reuse the rows. Payload: `consumedBy`, `suggestion`.

### RUNTIME.JSON_SCHEMA_VALIDATION_FAILED

The `arktype-json` codec rejected a JSON value that does not satisfy the column's arktype schema, on writing (`toWire`, `toDataTypeValue`) or reading (`fromWire`, `fromDataTypeValue`). Also thrown when the schema itself cannot be rehydrated from the contract's stored JSON IR. Payload: `codecId`, `issues` (validation) or `jsonIr` (rehydration).

### RUNTIME.MIDDLEWARE_FAMILY_MISMATCH

A middleware registered on the runtime declares a `familyId` (e.g. `sql`) that differs from the runtime's family, e.g. a SQL-only middleware added to a Mongo runtime. Checked when the runtime validates its middleware list. Payload: `middleware`, `middlewareFamilyId`, `runtimeFamilyId`.

### RUNTIME.MIDDLEWARE_INCOMPATIBLE

A middleware declares a `targetId` without also declaring a `familyId`, an invalid combination, since target scoping only makes sense within a family. Checked when the runtime validates its middleware list. Payload: `middleware`, `targetId`.

### RUNTIME.MIDDLEWARE_RESULT_MISMATCH

Middleware returned a query result for a statistics operation, or statistics for a row query. Middleware interception results must carry the same `operation` discriminant as the operation they intercept. Payload: `expected`, `received`.

### RUNTIME.MIDDLEWARE_TARGET_MISMATCH

A middleware declares a `targetId` (e.g. `postgres`) that differs from the runtime's configured target. Checked when the runtime validates its middleware list. Payload: `middleware`, `middlewareTargetId`, `runtimeTargetId`.

### RUNTIME.MISSING_EXTENSION_PACK

At SQL context construction, the contract requires one or more extension packs that no component in the runtime stack provides. Add the missing pack(s) to the stack. Payload: `packIds`.

### RUNTIME.MONGO_STATISTICS_RESULT_INVALID

A Mongo update or delete command did not return exactly one result object with the required numeric native count field. Updates require `modifiedCount`; deletes require `deletedCount`. Payload: `commandKind`, `countField`.

### RUNTIME.MONGO_STATISTICS_UNSUPPORTED

Statistics execution was requested for a Mongo command that does not expose affected-row statistics. Only update and delete command kinds provide the native counts used by this operation. Payload: `commandKind`.

### RUNTIME.MULTIPLE_ORM_COPIES

Prisma ORM is loaded from more than one folder. Each folder holding `@prisma/orm-framework` is a separate copy, even at the same version, and values and registries made by one copy are not recognised by another. Commands and clients refuse to start, before they read the contract or connect. The message names each copy's version, and the details list each copy's folder.

Two copies usually mean versions that differ: an `@prisma/orm-*` package, or an extension, at a different version from the application's database package, or a `prisma` CLI that runs a different ORM version. Install the same version of every `@prisma/orm-*` package and a `prisma` CLI that runs it. `npm ls @prisma/orm-framework`, `pnpm why @prisma/orm-framework` or `bun why @prisma/orm-framework` shows which package brought each copy. npm refuses a mismatched peer dependency, but pnpm and bun only warn, so a mismatch can install without an error. When every copy has the same version, reinstall so the package manager keeps one copy. With pnpm, copies of one version can also differ by their peer dependencies: `pnpm why @prisma/orm-framework` shows the difference, and giving every dependent the same peer leaves one copy.

Copies bundled into a single file can't be told apart, so this check doesn't detect them. Payload: `copies`, a list of `{ folder, version }`; `version` is absent where it cannot be read.

### RUNTIME.MUTATION_DEFAULT_GENERATOR_MISSING

The contract declares column or field defaults produced by a mutation default generator (e.g. a nanoid/uuid generator, or `timestampNow` behind `temporal.CreatedAt`) that no runtime component provides, detected up front when the SQL context or the Mongo execution context validates generator coverage, or at mutation time when a generator-kind default spec is resolved. The message names each missing generator with the `<collection or table>.<field>` entries that need it, and says where generators come from: the built-in ones, `timestampNow` among them, from the database adapter's runtime descriptor, others from the extension pack that defines them. Payload: `ids` and `fields` (validation pass) or `id` (resolution).

### RUNTIME.NAMESPACE_UNKNOWN

At query-render time a table references a namespace that is not present, or not materialised as a database schema, on the contract. Raised by the Postgres and SQLite SQL renderers. Payload: `table`, `namespaceId`, `reason`.

### RUNTIME.NO_ROWS

`firstOrThrow()` was called on a query result that returned no rows. Use `first()` if an empty result is acceptable.

### RUNTIME.PARAM_PLACEHOLDER_MISMATCH

The SQLite SQL renderer wrote a statement whose placeholders do not match its parameters: a bare `?` or a numbered placeholder no parameter has, usually a `?` written into raw SQL text, or a parameter no placeholder binds. The renderer refuses the statement rather than bind a value to the wrong place. Pass values into raw SQL by interpolation, not as a `?` in the text. The message and payload give the counts and the first five placeholders written. Payload: `placeholderCount`, `paramCount`, `firstPlaceholders`.

MySQL raises it in four places, each refusing the statement before it runs:

- The MySQL adapter, after lowering, when a placeholder is not a numbered `?N` naming one of the statement's parameters, or a parameter has no placeholder, usually because of a `?` written into raw SQL text. Payload: `placeholders`, `params`.
- The MySQL adapter, when raw SQL puts a digit right after an interpolated value, which would read as part of the value's `?N` (`?1` followed by `0` reads as `?10`). Payload: `reason: 'digit-after-value'`, `part`.
- The MySQL drivers, when a statement mixes numbered `?N` and bare `?` placeholders, or its placeholders and values do not match. Payload: `placeholders`, `params`.
- The MySQL drivers, when the number of placeholders MySQL reads in the prepared statement differs from the number of values, usually because a statement changed `sql_mode`, as turning on `NO_BACKSLASH_ESCAPES` or `ANSI_QUOTES` does. Payload: `prepared`, `params`.

### RUNTIME.PARAM_REF_CODEC_REQUIRED

While building a query expression, a plain JS value was passed where no codec could be derived: `toExpr` cannot construct a ParamRef for a bare value without an explicit `CodecRef`. Provide a codec at the call site or use a column-bound builder path.

### RUNTIME.PARAM_REF_MISSING_CODEC

The Postgres SQL renderer reached lowering with a ParamRef that carries no bound `CodecRef`, an internal invariant of the AST-bound codec contract, usually indicating a builder path that constructed a ParamRef without threading the column codec. Payload: `paramIndex`, `name`.

### RUNTIME.PREPARE_BIND_ON_ADHOC

An AST containing a prepared-statement bind-site reference (`PreparedParamRef`) was submitted to the ad-hoc `execute()` path. Bind-site references are only valid inside `runtime.prepare(...)`. Payload: `name`.

### RUNTIME.PREPARE_MISSING_PARAM

Executing a prepared statement without supplying a value for one of its declared parameters: the lookup fails rather than silently binding `undefined`. Payload: `name`.

### RUNTIME.PREPARE_UNUSED_PARAM

`runtime.prepare(declaration, callback)` found declared parameter names that the callback's plan never references. Remove the unused declarations or reference them in the plan. Payload: `unused`.

### RUNTIME.RAW_ROW_COLUMN_MISSING

A whole-query raw statement returned a result that omits a column its row spec declares. The runtime never parses the SQL, so the spec is its only description of the result: a column the spec names and the statement does not return is a mismatch the caller has to resolve, by correcting the spec or the statement. Distinct from `RUNTIME.DECODE_FAILED`, which means a codec rejected a value the runtime did expect. Surplus result columns the spec does not declare are dropped silently and never raise this. See [ADR 247](../architecture%20docs/adrs/ADR%20247%20-%20Whole-query%20raw%20SQL%20is%20the%20fragment%20mechanism%20at%20statement%20position.md). Payload: `column`, `declaredColumns`, `resultColumns`.

### RUNTIME.RAW_SQL_UNSUPPORTED_INTERPOLATION

A raw-SQL tagged template interpolated a JS value whose type cannot be auto-inferred to a codec (anything other than number, bigint, string, boolean, or Uint8Array). Wrap the value in `param(...)` with an explicit codec.

### RUNTIME.TEMPORAL_UNAVAILABLE

A value that only a `Temporal` implementation can produce or read was needed in a process that has neither a global `Temporal` nor the fallback `Temporal` of the Postgres target. Two paths raise it, and they carry different metadata:

- A Temporal-backed codec (`pg/date-temporal@1`, `pg/timestamp-temporal@1`, `pg/timestamptz-temporal@1`, `pg/time-temporal@1`) decoding a value. Payload: `codecId`, `operation` (`'decode'`). Encoding a `Temporal` value needs no implementation and does not raise this error.
- The `instantNow`, `plainDateTimeNow`, `plainDateNow` or `plainTimeNow` mutation-default generator producing a value, for `temporal.CreatedAt`, `temporal.UpdatedAt`, or for a `TimestamptzTemporal`, `TimestampTemporal`, `TimestampInstant`, `DateTemporal`, `Date`, `TimeTemporal` or `Time` field with `@onCreate(now())` or `@onUpdate(now())`. No codec is involved. Payload: `generatorId`.

The check is lazy: registering the target, validating a contract, building a runtime or a client, resolving a descriptor and constructing a codec instance all succeed without `Temporal`. Only producing or interpreting a value fails, including the first read of a `db.enums` enum whose codec is a Temporal codec.

It is raised on **reads**, because the check is the first thing a Temporal codec does on decode: selecting the column is enough. And it is raised on an **insert into a table carrying `temporal.UpdatedAt`**, because that column's clock produces a `Temporal.Instant` even when your code never mentions a temporal value; that path reports `generatorId` rather than `codecId`, since no codec has been reached yet.

This error never occurs in the control plane. The CLI commands, `node migration.ts`, the Vite plugin, the language server and the programmatic control client all load `prisma.config.ts` or the control descriptors, and so load the target's control entry. The target's control entry (`@internal/target-postgres/control`) sets the fallback `Temporal`, from `temporal-polyfill`, when it is loaded. It does not set `globalThis.Temporal`. `temporal-polyfill` is a required peer dependency of `@prisma/orm-postgres` and `@prisma/orm-target-postgres`. npm, pnpm and bun install it automatically; a project that uses Yarn adds it to its own dependencies. When it is not installed, loading the control entry fails because Node.js cannot find the package `temporal-polyfill`, not with this error. The fallback is held once per process, and every Postgres codec in the process uses it. An application process that loads no control-plane code and has no global `Temporal` gets `RUNTIME.TEMPORAL_UNAVAILABLE`. An application that loads control-plane code in its own process, such as server code under `vite dev` with the Prisma Vite plugin or a script that calls the control client, decodes dates without its own `Temporal`, and then fails in production. An application that uses the Temporal codecs must load its own `Temporal`.

In the application, install a global implementation before any query runs (`import 'temporal-polyfill/full/global'`), or author the column with its `*String` type (`DateString`, `TimestampString(p)`, `TimestamptzString(p)`, `TimeString(p)`) to read and write ISO 8601 text, which needs no Temporal at all.

### RUNTIME.TRANSACTION_ALREADY_OPEN

`transaction()` was called on an activity handle opened on a connection while a transaction it began on that connection is still open. A connection runs one transaction at a time, and transactions do not nest. Commit or roll back the open transaction first, or send the work on it. Payload: `kind`, `id`, `transactionId`.

### RUNTIME.TRANSACTION_CLOSED

A query result created inside a transaction was read after the transaction ended. Await the result or call `.toArray()` inside the transaction callback.

### RUNTIME.TRANSACTION_COMMIT_FAILED

Committing a transaction failed; the runtime attempts a cleanup rollback and destroys the connection if that also fails. The driver's commit error is attached as `cause`. Payload: `commitError`.

### RUNTIME.TRANSACTION_ROLLBACK_FAILED

Rolling back a transaction after the callback threw itself failed; the connection is destroyed rather than returned to the pool. The original callback error is attached as `cause`. Payload: `rollbackError`.

### RUNTIME.TYPE_PARAMS_INVALID

A parameterized codec's `paramsSchema` rejected the `typeParams` carried by a codec reference (or the schema returned a Promise; runtime validation requires a synchronous Standard Schema validator). The `arktype-json` codec also throws it when the contract's serialized schema expression does not match the rehydrated schema, indicating a stale or hand-edited contract. Payload: `codecId`, `typeParams` (plus `table`/`column` or `typeName` on the contract-walk path).

## DRIVER

### DRIVER.ALREADY_CONNECTED

Calling `connect(binding)` on a driver, or `connect()` on a client (`postgres()`, `sqlite()`, `mongo()`) or the CLI control client, when it is already connected. Close with `close()` before reconnecting with a new binding. Payload: `bindingKind`.

### DRIVER.CONNECTION_FAILED

A control-plane driver could not establish a database connection (`driver.create(url)` in the SQLite, Postgres, MySQL, and Mongo control drivers), or `connect({ url })` on a serverless Postgres client (`@prisma/orm-postgres/serverless`) could not open its `pg.Client`'s database connection: the database refused the connection, rejected the credentials, or did not answer within the 20 second connect timeout. The `why` carries the underlying driver message and the original error is attached as `cause` (for the serverless client, the driver's connection error, which wraps pg's own); connection URLs in meta are redacted. The MySQL runtime driver also raises it when a statement waits longer than the URL's `poolTimeout` (ten seconds by default) for a free pooled connection, with `poolTimeoutMs`. Payload: `path` (SQLite); `sqlState` plus redacted URL fields (Postgres control driver); redacted URL fields (Mongo, MySQL); `extension: 'postgres'` plus redacted URL fields (serverless `connect`).

### DRIVER.NOT_CONNECTED

Using a driver, a client, or the CLI control client before `connect(...)` has been called, or after it was closed. It surfaces from runtime `query` / `execute`, a prepared statement's `query(target, params, options?)`, `acquireConnection`, or `explain`, including lazily when iterating a query result. A closed Postgres client raises it as "Postgres client is closed" from every member, synchronously; it also closes its runtime, so a runtime captured with `runtime()` before `close()` refuses new work at once with "Runtime is closed" (a caller's pool or `pg.Client` stays open); and a closed serverless connection raises it as "Postgres connection is closed" from `runtime()`; the connection's ORM queries, `transaction(...)` and prepared statements follow the runtime's rule below. The SQL runtime raises it with the message "Runtime is closed" for a query, execute, prepared statement or `connection()` that starts once the runtime refuses new work; its `fix` names the missing `await`, and the rejection is immediate. When refusal begins depends on the runtime's `closeRefusal` policy. With `'at-once'`, which a Postgres client built from `{ url }` uses, it begins when `close()` is called, and work already in flight completes. With `'when-idle'`, which a serverless connection uses, it begins once `close()` has been called and the runtime has then been idle for one turn of the event loop (a `setTimeout(0)`), so a lazy result returned without `await` from an `await using` scope and awaited after the scope ended is refused, while work that keeps the runtime busy from the close onward, including an ORM write's reload and a helper's chain of queries through the ORM, completes, because `close()` waits for it, and is never refused because of the close; if it fails for its own reason, it rejects like any unawaited promise. Work that starts after the runtime was idle for a turn is refused; whether a query sent after waiting on something other than the database counts as idle depends on timing, so do not rely on it; an unawaited promise that fails then, or fails for its own reason, rejects like any unawaited promise, and Node reports it as unhandled. The Postgres driver's own messages are "Postgres driver is closed. Call connect(binding) to reconnect." after `close()`, "Postgres connection lost or closed. Create a new client to reconnect." from a query on a `pg.Client` whose connection was lost, whoever created it, since a pg client cannot reconnect, and "Postgres connection lost or closed. Call connect(binding) to reconnect." from the runtime on a later use, once that connection was destroyed. Binding a client the driver already gave up on fails with "This pg client lost its connection or was given up by an earlier driver. Create a new client to reconnect." The MySQL control driver raises it as "MySQL connection lost or closed" for every query after the server closed its connection or the connection failed, with the connection's error as `cause` and its message as `why`. The MySQL runtime driver raises it with the same message when the connection under a streaming query is lost, because mysql2 tells the query nothing; the connection is evicted.

### DRIVER.PREPARE_FAILED

A prepared statement failed again after the PostgreSQL driver discarded a stale handle and retried with a fresh handle. The normalized PostgreSQL error is attached as `cause`. Payload: `handle`. The MySQL drivers raise it for a statement MySQL cannot run as a prepared statement (MySQL error 1295, `ER_UNSUPPORTED_PS`), such as `LOCK TABLES`: they send every statement with values as a prepared statement. They also raise it when the server has reached its limit on open prepared statements (error 1461, `max_prepared_stmt_count`, 16,382 by default), with a `fix` that names `statementCacheSize` and `connectionLimit`. The MySQL error is attached as `cause`. Payload: `sql`.

## MIGRATION

A migration runner fails with its own code: `MIGRATION.SCHEMA_VERIFY_FAILED`, `MIGRATION.PRECHECK_FAILED`, `MIGRATION.POSTCHECK_FAILED`, `MIGRATION.EXECUTION_FAILED`, `MIGRATION.POLICY_VIOLATION`, `MIGRATION.MARKER_ORIGIN_MISMATCH`, `MIGRATION.MARKER_CAS_FAILURE`, `MIGRATION.DESTINATION_CONTRACT_MISMATCH`, `MIGRATION.FOREIGN_KEY_VIOLATION` or, on MongoDB, `MIGRATION.DATA_TRANSFORM_CHECK_NOT_READ_ONLY`. `db init`, `db update` and `db migrate` report that code, its `why` and its payload unchanged, and add their advice. The payload also carries `failingSpace`, the contract space whose plan failed (`app` for the application's own), and `databaseUnchanged`: `true` when the database is as it was before the apply, `false` when what ran stays applied; creating the marker and ledger tables does not count as a change. Postgres and SQLite, whose DDL is transactional, roll back every failed apply, so it is always `true` there. MySQL and MongoDB apply one space at a time: MySQL commits each DDL statement as it runs and MongoDB does not wrap its operations in a transaction, so it is `false` once an operation, or a space's marker, has been written. The runner's `why` ends with "The failed apply changed nothing." or "The operations that ran before the failure stay applied." to match. When the apply stopped in a space other than the application's, the CLI adds `The apply stopped in contract space "<space>".` to the `why`.

### MIGRATION.ALTER_COLUMN_TYPE_USING_WITHOUT_TYPE_CHANGE

A hand-written PostgreSQL `this.alterColumnType({ schema, table, column, type, using })` has a `using` conversion, but the migration's start contract, after the renames made earlier in the same migration, already gives the column `type`. Only a call with `using` is refused; an unchanged type without `using` loses nothing when it is skipped. The operation's postcheck checks only the column's type, which already holds, so the runner would skip it and the conversion would never run. Raised when `migration.ts` builds its operations, so no `ops.json` is written. Write the conversion as a `dataTransform`, which checks the rows themselves, or change the column to another type. Payload: `where`, `type`.

### MIGRATION.AMBIGUOUS_MIGRATION_REF

A migration reference (directory name or hash prefix) passed to a CLI command matches migrations in more than one contract space, so the command cannot tell which one you mean. Re-run with `--space <id>` to pick a space. Payload: `ref`, `spaceIds`.

### MIGRATION.BUNDLE_NOT_FOUND_FOR_GRAPH_NODE

A hash resolves to a node in the migration graph, but no on-disk migration package has that hash as its destination (`to`), so there is no bundle to read for it. Hit when resolving a ref or hash to a migration bundle (e.g. `migration show`, contract-at resolution). Payload: `hash`, `explicitLabel` (when the user supplied a named reference).

### MIGRATION.CHECK_CONTRACT_UNREADABLE

A `migration check` finding, carried as an `error` diagnostic on a completed run that exits `4`: the `contract.json` for a contract space cannot be read or validated. Re-emit the extension contract artifacts or fix the descriptor producing the invalid contract.

### MIGRATION.CHECK_DANGLING_REF

A `migration check` finding, carried as an `error` diagnostic on a completed run that exits `4`: a ref file points at a contract hash that does not exist in the space's migration graph. Update the ref with `prisma migration ref set <name> <valid-hash>` or delete it.

### MIGRATION.CHECK_DECLARED_BUT_UNMIGRATED

A `migration check` finding, carried as an `error` diagnostic on a completed run that exits `4`: an extension is declared in `extensions` but has no on-disk migrations directory under `migrations/`. Re-emit the extension's contract-space artifacts, or remove the extension from `extensions`.

### MIGRATION.CHECK_DUPLICATE_MIGRATION_HASH

A `migration check` finding, carried as an `error` diagnostic on a completed run that exits `4`: multiple migration packages in the same contract space share the same `migrationHash`, so the packages are not uniquely content-addressed. Re-emit one of the conflicting packages.

### MIGRATION.CHECK_FILE_MISSING

A `migration check` finding, carried as an `error` diagnostic on a completed run that exits `4`: a required file (`migration.json` or `ops.json`) is missing from a migration package directory. Re-emit the package or restore it from version control.

### MIGRATION.CHECK_HASH_MISMATCH

A `migration check` finding, carried as an `error` diagnostic on a completed run that exits `4`: the `migrationHash` stored in `migration.json` does not match the hash recomputed from the package contents: the package was edited or partially written since emit. Re-emit the package or restore it from version control.

### MIGRATION.CHECK_HEAD_REF_MISSING

A `migration check` finding, carried as an `error` diagnostic on a completed run that exits `4`: a contract space has no `refs/head.json`. Re-emit the contract-space migrations and head-ref artifacts, or restore the file from version control.

### MIGRATION.CHECK_HEAD_REF_NOT_IN_GRAPH

A `migration check` finding, carried as an `error` diagnostic on a completed run that exits `4`: the hash in a space's `refs/head.json` is not a node in that space's migration graph. Re-emit the space's migrations or restore the missing migration package.

### MIGRATION.CHECK_NOOP_SELF_EDGE

A `migration check` finding, carried as an `error` diagnostic on a completed run that exits `4`: a migration has identical source and target hashes and declares no data invariant, a true no-op self-edge. Add a data operation if it was meant to carry one, or delete the migration.

### MIGRATION.CHECK_ORPHAN_SPACE_DIR

A `migration check` finding, carried as an `error` diagnostic on a completed run that exits `4`: a contract-space directory exists under `migrations/` but no declared extension claims it. Remove the directory or declare the extension in `extensions`.

### MIGRATION.CHECK_PACKAGE_UNLOADABLE

A `migration check` finding, carried as an `error` diagnostic on a completed run that exits `4`: a migration package directory exists but could not be loaded (parse or validation failure); the row's detail names the underlying cause. Re-emit the package or restore it from version control.

### MIGRATION.CHECK_PROVIDED_INVARIANTS_MISMATCH

A `migration check` finding, carried as an `error` diagnostic on a completed run that exits `4`: the `providedInvariants` list stored in `migration.json` disagrees with the one derived from `ops.json`. Re-emit the package so the two files agree.

### MIGRATION.CHECK_REF_UNREADABLE

A `migration check` finding, carried as an `error` diagnostic on a completed run that exits `4`: a ref file in a space's `refs/` directory cannot be read or parsed. Repair or remove the corrupt ref file.

### MIGRATION.CHECK_SNAPSHOT_CONTENT_MISMATCH

A `migration check` finding, carried as an `error` diagnostic on a completed run that exits `4`: a contract snapshot's declared `storage.storageHash` agrees with the migration's `to` hash, but the snapshot's content recomputes to a different storage hash — the file under `migrations/snapshots/<hash>/` has been edited (or corrupted) since it was written. Restore `migrations/snapshots/` from version control, or re-run the command that produced the migration to regenerate its snapshot.

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

### MIGRATION.COLUMN_RENAME_UNMATCHED

`this.renameColumn({ table, column, to })` in a hand-written migration does not match the migration's contracts: the migration has no start contract, the table does not exist at that point of the migration (or, with no `schema`, is declared in more than one namespace), the table has no column `column`, the table already has a column `to`, or the end contract has no column `to` on that table. Raised when the migration's operations are built, so `migration.ts` writes no `ops.json`. Order the rename calls in the sequence the renames happen and check the table, column and namespace names. Payload: `table`, `from`, `to`.

### MIGRATION.COLUMN_TYPE_UNREADABLE

A Postgres column type change names a type that no data type of the configured stack reads. `alterColumnType` checks after it runs that the column has the new type as `format_type()` prints it, and finds that text from `type`, written as a migration writes it, through the data types the target, adapter and extensions register: any of a data type's texts, such as `int4`, `integer` or `varchar(20)`, with `[]` for a list, or an enum named by its quoted name, such as `"Mood"` or `"app"."status"`; an enum in `public` may be written with or without `"public".`, and the check leaves the schema out, as `format_type()` does. The message names the call, for example `alterColumnType({ table: "User", column: "age" })`, and the text. Write the type as a migration writes it, or, for a type an extension provides, add that extension to the configuration. A raw type (ADR 273), which no data type reads, is marked in the call with `raw: true`, as the planner writes it; it is checked as written, and refused with this code when it is not one type name. Raised when `migration.ts` runs, and by the planner, which builds the same call. Also raised when a hand-written call passes no `type`, since `node migration.ts` does not check the types of its options; the message says so, and the fix gives the shape `alterColumnType` takes, `{ schema, table, column, type, using? }`. Payload: `type`, `where`.

### MIGRATION.COPY_EXPRESSION_COLUMN_UNKNOWN

A SQLite `recreateTable` call in `migration.ts` has a `copyExpressions` or `temporaryValues` key, or a `retypedColumns` entry, that names no column of the new table (`contractTable.columns`). Each key names the column its expression or value fills, so a mistyped key would leave the column it meant copied unchanged or without a value; each `retypedColumns` entry names a retyped column whose values the rebuild checks after its copy, so a mistyped one would leave those values unchecked. The message names the call, the key and the table's columns, for example `recreateTable({ tableName: "User" }): copyExpressions.Age names no column of the new table. Its columns are "id", "age".` Raised when `migration.ts` runs, before anything is written. Key the expression by the column's name, with the same letters and case. Payload: `call`, `key`, `columns`.

### MIGRATION.CONTRACT_DESERIALIZATION_FAILED

A contract JSON on disk failed to deserialize into a valid contract: either a snapshot-store entry read while migration tooling resolved a contract at a ref or hash, or the emitted `contract.json` read as the fallback source by `db sign` / `db update --to` (invalid JSON, or a value that is not a JSON object). Re-emit the owning migration package (or re-run `prisma contract emit` for the emitted contract), or restore the file from version control. Payload: `filePath`, `message`. Also raised by `migration new` when the emitted `contract.json` fails to deserialize; that site has no meta and attaches the deserialization failure as `cause`.

### MIGRATION.CONTRACT_SNAPSHOT_CONTENT_MISMATCH

A contract snapshot loaded from `migrations/snapshots/<hash>/contract.json` does not reproduce the storage hash it is addressed by: the store is content-addressed, and the file has been edited (or corrupted) since it was written. Raised at the snapshot-store load seam, so every command that resolves a contract from the store (`migration plan`, `migration ref set`, `db sign` / `db update --to`, aggregate contract resolution) refuses instead of treating the edited content as the recorded contract. The envelope names the file and both hashes (meta: `storageHash`, `computedHash`, `jsonPath`). Restore `migrations/snapshots/` from version control, or re-run the command that authored the referencing migration to regenerate the snapshot.

### MIGRATION.CONTRACT_SNAPSHOT_HASH_MISMATCH

While writing a contract snapshot, the contract JSON's inner `storage.storageHash` does not equal the storage hash the snapshot is being filed under: the two must agree by construction. Primarily an authoring/tooling invariant rather than something a user causes directly. Payload: `storageHash`, `actualHash`, `dir`.

### MIGRATION.CONTRACT_SNAPSHOT_MISSING

A contract snapshot expected under `migrations/snapshots/` for a given storage hash does not exist on disk, so commands that need the contract at that hash (`migration plan`, `ref`-based resolution, `migration check`) cannot proceed. Re-run the command that authored the referencing migration to regenerate the snapshot, or restore `migrations/snapshots/` from version control. Payload: `storageHash`, `expectedPath`.

### MIGRATION.CONTRACT_SPACE_LAYOUT_VIOLATION

The on-disk `migrations/` directory and the `extensions` declaration in config disagree: an orphan space directory exists with no declaring extension, or a declared extension has no migrations directory. All layout offences are bundled into one envelope. Raised when db commands load the contract-space aggregate. Payload: `violations` (list of `{kind, spaceId}`).

### MIGRATION.CONTRACT_SPACE_VIOLATION

A contract-space check raised under one code, in two lanes with different exits. As an error at exit `2` when the check could not run: a space's target mismatches the project target, two spaces claim the same storage element, a space contract is unreadable, or aggregate introspection failed (`db verify`, `db init`, `db update`). As an `error`-severity diagnostic on a completed `db verify` run that exits `4`, including under `--marker-only`, when the check ran and found per-space marker drift: a marker hash mismatch, missing invariants, or an orphan marker row, reported next to the single-contract marker findings that already settle there. The envelope's `why` lists the specific violations. Payload: `violations`.

### MIGRATION.CONTRACT_VIEW_MISSING

A migration object's `endContract`/`startContract` accessor was read, but the instance carries no `endContractJson`/`startContractJson` to build the contract view from, typically a migration that overrides `describe()` and carries no contract. Payload: `className`, `accessor`, `jsonField`.

### MIGRATION.DATA_TRANSFORM_CHECK_NOT_READ_ONLY

MongoDB only: a data transform's precheck or postcheck reads with a command that writes, such as an update, so running the check could change the database. The runner refuses the check before sending it. Write the check's source as an `aggregate` or `rawAggregate` pipeline. Payload: `checkDescription`, `commandKind`, `collection`.

### MIGRATION.DATA_TRANSFORM_CONTRACT_MISMATCH

At migration authoring/emit time, a `dataTransform(endContract, …)` produced a query plan whose storage hash does not match the contract passed to `dataTransform`: the query builder was configured with a different contract reference than the migration itself. Make both use the same imported `endContract`. Payload: `dataTransformName`, `expected`, `actual`.

### MIGRATION.DESCRIBE_INVALID

A migration author class's `describe()` result is unusable: it carries neither an `endContractJson` nor an override, or the returned metadata fails validation. Raised while loading/describing an authored migration. Payload: `reason`.

### MIGRATION.DESCRIPTOR_HEAD_HASH_MISMATCH

An extension descriptor publishes a `contractSpace` whose `headRef.hash` does not match the hash recomputed from its `contractJson`: the descriptor was published with a stale head hash, typically because the contract was bumped without rerunning the extension's emit pipeline. Payload: `extensionId`, `recomputedHash`, `headRefHash`.

### MIGRATION.DESTINATION_CONTRACT_MISMATCH

Runner-level failure during apply (`db init`, `db update`, `db migrate`): the plan's destination storage hash (or profile hash) does not match the destination contract handed to the runner alongside it. Indicates the plan and contract came from different emits. Payload: `planStorageHash`/`contractStorageHash` (or `planProfileHash`/`contractProfileHash`).

### MIGRATION.DIR_EXISTS

`migration new`/`migration plan` refused to scaffold because the target migration directory already exists: each migration needs a unique directory. Pick a different `--name` or delete the existing directory. Payload: `dir`.

### MIGRATION.DUPLICATE_INVARIANT_IN_EDGE

Two `dataTransform` operations on the same migration declare the same `invariantId`. Invariants are stored per-migration as a set, so two operations cannot share a routing identity; rename one, or drop the `invariantId` on the operation that need not be routing-visible. Payload: `invariantId`.

### MIGRATION.DUPLICATE_MIGRATION_HASH

While reconstructing the migration graph, two migrations were found sharing the same `migrationHash`; each migration must have a unique content-addressed identity. Regenerate one of the conflicting migrations. Payload: `migrationHash`.

### MIGRATION.DUPLICATE_SPACE_ID

The per-space migration planner received the same contract-space id more than once, usually a repeated entry in `extensions`. Deduplicate the inputs. Payload: `spaceId`.

### MIGRATION.EXECUTION_FAILED

A migration operation's SQL step failed while being executed against the database during apply (`db init`, `db update`, `db migrate`). The envelope carries the database error detail so you can see which statement failed and why. When the step converts a column's values, the failure names the field and says who converted them and why it failed (`failedTypeChange`: `by` is `cast` or `conversion`; for a cast, `reason` is `value` or `noCast`; for a conversion, `value`, `invalidResult` or `expressionError`). On Postgres every SQL error of an alter with `using`, other than a connection, transaction or server failure, is the conversion's; on SQLite an error of the copy step of a rebuild that converts columns is the conversion's only when a copy expression fails on its own (`expressionError`) or the broken constraint names a converted column (`invalidResult`); any other error of the copy, such as a duplicate in another column made unique, gets the general advice. When a SQLite table rebuild's copy fails on a column becoming required, it counts the rows with no value (`rowsWithoutValue`) and the summary says so. `db init`, `db update` and `db migrate` report it with this code. When a type change answered with `--delete` met a value the database's cast cannot convert, or the database has no cast between the two types (on SQLite, a value kept a storage class its new column does not hold, and the why names the first such value). The advice names `--convert <field>`: through `migration plan` for `db update`, starting from `--from <hash>` under the same condition. For `db migrate` it says the failed migration's `migration.ts` has no conversion for the field and to write one there, run the file with `node`, and re-run `db migrate`, or to plan the failed migration again with `--convert`. When the migration's own `--convert` conversion failed, the advice says how: `The conversion of field "User.age" failed on a value its new type cannot hold.` (Postgres raised an error on a value), `… left a value its new type cannot hold.` (the SQLite check found one, or the value broke a constraint), or `… failed with an error in its expression.` (any other error of the conversion, such as an unknown function or operator). It then says to fix the conversion in that migration's `migration.ts`, run the file with the printed `node` command, and re-run `db migrate`, each command repeating the run's `--config` and `--db`. Rows without a value are advised as for `MIGRATION.PRECHECK_FAILED`. On Postgres a table drop that a view or another object depends on fails here (SQLSTATE `2BP01`): the summary names each dependent object from Postgres's error detail, such as `Table "billing"."Invoice" cannot be dropped while view billing.v_paid depends on it.`, the payload lists them as `blockingObjects`, and the advice says to drop or change them in the database and re-run the same command with the same `--to` and statements. Payload: `operationId`, `stepDescription`, `sql`, `sqlState`, `constraint`, `table`, `column`, `detail`, `failedTypeChange` or `rowsWithoutValue` when the step converted values or tightened a column, and `blockingObjects` (each `{ kind, name }`) when objects depend on what the step drops. On MongoDB it is raised when a field rename or removal rewrites documents with `bypassDocumentValidation` and the database user lacks that action (MongoDB error 13, `Unauthorized`), as a `readWrite` user on a hosted cluster does; the message says to grant the `bypassDocumentValidation` action, for example with the `dbAdmin` or `restore` role, and to run the command again. Payload: `operationId`, `mongoCode`, `codeName`. When the connection is lost during the step, such as the server ending the session (SQLSTATE class `08` or `57P01`–`57P05`), the payload also carries `connectionLost: true`, `transient`, and the `sqlState` when the server sent one. On MySQL, an error thrown while a space applies that has a structured code, such as `CONTRACT.MARKER_ROW_CORRUPT` or a `DRIVER` error, is reported as it is, with its own code, advice and docs link, and with `failingSpace` and `databaseUnchanged` added to its payload. An error without one, such as a socket error from the driver, is reported with this code, its own code in `errorCode`, and `failingSpace` and `databaseUnchanged`. When releasing the marker lock fails after a failed apply, the apply's failure is what is reported.

### MIGRATION.FIELD_NAME_UNSUPPORTED

A MongoDB `renameField` or `unsetField` operation names a field it cannot rewrite: an empty name, `_id` (MongoDB does not let a document change its `_id`), a name containing `.` (MongoDB reads it as a path into embedded documents), or a name starting with `$` (MongoDB reads it as an operator). Raised when the operation is built, before anything runs. Payload: `collection`, `field`, `reason`.

### MIGRATION.FILE_MISSING

A required migration file is absent: either an on-disk package is missing `migration.json`/`ops.json` (migration-tools loader; re-emit via the package's `migration.ts`), or a `migration.ts` source file was expected at a package directory and not found (scaffold one with `migration new` or `migration plan`). Payload: `file`, `dir` (loader variant) or `dir` (source-file variant).

### MIGRATION.FOREIGN_KEY_VIOLATION

SQLite only: after applying migration plans with `PRAGMA foreign_keys` temporarily off (needed for recreate-table operations), the post-apply `PRAGMA foreign_key_check` reported broken references, and the whole transaction is rolled back. Payload: `violations` (rows from the pragma).

### MIGRATION.HASH_MISMATCH

A migration package on disk is corrupt: the `migrationHash` stored in `migration.json` does not match the hash recomputed from the package contents. Raised whenever migration tooling loads packages (plan, list, apply). Re-emit the package via its `migration.ts` or restore from version control. Payload: `dir`, `storedHash`, `computedHash`.

### MIGRATION.HASH_NOT_IN_GRAPH

A contract hash the user supplied (or that a ref resolved to) is not a node in the on-disk migration graph, raised during plan resolution (`migration plan --from`), `migration ref set`, and `migration new --from` (including `--from` on an empty migrations directory, where there is no migration target it could name). The envelope lists the reachable hashes and suggests a valid one or running `migration plan` to introduce it. Payload: `hash`/`resolvedHash`, `reachableHashes` or `reachableRefs`; none at the `migration new` sites.

### MIGRATION.INVALID_DEFAULT_EXPORT

The `migration.ts` in a package directory does not default-export a valid migration: it must export a `Migration` subclass or a factory function returning a plan-shaped object (`operations` array plus `targetId` and `destination`). Payload: `dir`, `actualExport` (when known).

### MIGRATION.INVALID_DEST_NAME

A copy-destination name in a migration package's copy list is not a single path segment (contains `..` or directory separators). Use a simple file name such as `contract.json`. Payload: `destName`.

### MIGRATION.INVALID_INVARIANT_ID

An `invariantId` on a `dataTransform` is empty or contains whitespace/control characters. Pick an id without spaces, tabs, newlines, or control characters. Payload: `invariantId`.

### MIGRATION.INVALID_JSON

A migration file (`migration.json` or `ops.json`) exists but is not parseable JSON. Re-emit the package via its `migration.ts` or restore from version control. Payload: `filePath`, `parseError`.

### MIGRATION.INVALID_MANIFEST

A `migration.json` manifest parsed as JSON but failed schema validation, or an `ops.json` holds a check whose `expectation` (on MongoDB, `object`) has the wrong shape. Re-emit the package or restore from version control. Payload: `filePath`, `reason`.

### MIGRATION.INVALID_NAME

The migration name given to `migration new`/`migration plan --name` contains no valid characters after sanitization (only a-z and 0-9 are kept). Provide a name with at least one alphanumeric character. Payload: `slug`.

### MIGRATION.INVALID_OPERATION_ENTRY

An operation returned by an authored migration class failed schema validation during emit: each entry of `operations` must carry `id`, `label`, and an `operationClass` of `additive`, `widening`, `destructive`, or `data`. Also raised when deserializing a persisted Mongo migration plan hits a malformed or unknown entry (filter, pipeline stage, DML/DDL/inspection command). A MongoDB `renameField` whose new name is its old name raises it when the operation is built, with `context: 'renameField'`, `collection`, `field` and `reason`. Payload: `index`, `reason` (emit validation) or `context`, `kind` (plan deserialization).

### MIGRATION.INVALID_REF_FILE

A ref file under `migrations/<space>/refs/` is not valid JSON or does not match the expected `{ "hash": "<64 hex>", "invariants": [...] }` shape. Payload: `path`, `reason`.

### MIGRATION.INVALID_REF_NAME

A ref name is syntactically invalid: names must be lowercase alphanumeric with hyphens or forward slashes, with no `.` or `..` segments. Raised by `migration ref` commands and any ref-consuming tooling. Payload: `refName`.

### MIGRATION.INVALID_REF_VALUE

The value given for a ref (e.g. to `migration ref set`) is not a valid contract hash: it must be 64 lowercase hex chars or `empty`. Payload: `value`.

### MIGRATION.INVALID_REFS

A legacy `refs.json` file is invalid: it must be a flat object mapping valid ref names to contract hash strings. Payload: `path`, `reason`.

### MIGRATION.INVALID_SPACE_ID

A contract-space id (e.g. via `--space` or in planner input) does not match the required pattern `[a-z][a-z0-9_-]{0,63}`: space ids double as directory names under `migrations/`, so the rule is conservative. Payload: `spaceId`.

### MIGRATION.LEGEND_HUMAN_ONLY

`migration list --legend` was combined with a machine-readable or silent output flag (`--json`, `--dot`, or `--quiet`); the legend is human-only decoration on stderr. Drop one of the flags. Payload: `conflictingFlag`.

### MIGRATION.MARKER_CAS_FAILURE

While finalizing an apply, the compare-and-swap update of the database's contract marker found the marker had been modified by another process mid-migration: a concurrent migration raced this one. `db sign` reports the same code as a diagnostic, one per space, when a space's marker changed between the moment `db sign` read it and the moment it came to write it; that space is not signed and the command exits with code 4. Run `db sign` again once the other process has finished. Payload, from both: `space`; `expectedStorageHash`, the marker's storage hash when the process read it (`null` for no marker); `foundStorageHash`, the one it found when it came to write (`null` for no marker); `destinationStorageHash`, the one it would have written.

### MIGRATION.MARKER_LOCK_TIMEOUT

MySQL only: `db migrate`, `db init`, `db update` or `db sign` waited 60 seconds for the marker lock and another process still held it. Each of them takes the lock, a `GET_LOCK` named after the database, while it reads and writes the contract markers, and releases it on the same connection when it ends. Wait for the other process to finish, then run the command again. Payload: `timeoutSeconds`.

### MIGRATION.MARKER_MISMATCH

The database's marker names a contract that no migration in the space's migration graph starts or ends at. The usual cause is a migration the database applied that was later planned again or deleted, such as a branch deployed to a shared database and then rebased; `db update` or `db init` moving the database to a contract no migration ends at is another. Raised for the first such contract space, application space first, by `db migrate` before any DDL, by `db migrate --show`, and by the control API's `migrate`, so a Composer deploy shows it too. An extension space that ships no migrations is never refused. The `why` is read from the database's ledger: it names the last graph contract the database applied, then the applied migrations no longer on disk or planned again with different content, or the `db update`, `db init` or `db sign` that moved it outside the graph. For the application space the next actions give two recoveries: unless the database changes only through migrations, as production does, move it with `db update` after a `--dry-run`, which keeps its data; otherwise plan migrations from the last graph contract to the database's contract and on to the target. For an extension space, whose migrations come with the extension, they say to install a version of the extension whose migrations include the database's contract, and to list the space's migrations. Payload: `spaceId`; `markerHash`; `targetHash`; `lastGraphHash`, only when a ledger entry ends at a graph contract; `missingMigrations`, the applied migrations after it whose directories are no longer on disk, empty when no ledger entry ends at a graph contract and absent when the ledger could not be read.

### MIGRATION.MARKER_NOT_IN_HISTORY

A warning diagnostic (not a hard failure) in `migration status`: the database's marker hash does not match any migration in the history, meaning the database was updated outside the migration system. Hints suggest `db sign` (overwrite marker) or `db update` (push the contract).

### MIGRATION.MARKER_ORIGIN_MISMATCH

Runner-level failure during apply: the plan asserts an origin contract, but the database marker is missing, or its storage hash (or profile hash) differs from the plan's origin: the database is not at the state the plan was computed from. Re-plan from the database's actual state. `db init`, `db update` and `db migrate` report it with this code. Payload: `expectedOriginStorageHash` plus `markerStorageHash`/`markerProfileHash` depending on the branch.

### MIGRATION.MISSING_INVARIANTS

A diagnostic in `migration status`: the active ref requires data invariants that the database marker does not record as provided. If no path through the graph can supply them, status escalates to `MIGRATION.NO_INVARIANT_PATH`. Payload: `ref` (when a ref is active), `invariants` (the missing ids).

### MIGRATION.MYSQL_CONTROL_STACK_MISSING

MySQL twin of `MIGRATION.POSTGRES_CONTROL_STACK_MISSING`: a `MysqlMigration` operation that writes DDL through the control adapter (`createTable`, `addColumn`) was invoked on an instance constructed without a control stack. Payload: `operation`.

### MIGRATION.NO_CHANGES

`migration new` found the from and to contract hashes identical: there is nothing to migrate. Change the contract and re-run `prisma contract emit` first, or pass `--from <hash>` explicitly to author a data-only migration on the current contract hash. Payload: none.

### MIGRATION.NO_INVARIANT_PATH

The target (or named ref) requires data invariants, and no path through the migration graph from the current state covers all of them. Add a migration on the path that runs a `dataTransform` with each missing `invariantId`, or retarget the ref. Payload: `required`, `missing`, `structuralPath` (edges: `dirName`, `migrationHash`, `from`, `to`, `invariants`), `refName` (when applicable). Also raised per space by `db migrate` in show/plan mode when a space's path requires invariants not available on disk; that site's meta is `spaceId`, `missing`. `db init` and `db update` raise it for an extension space whose migrations reach its head ref but not through the migrations that provide the invariants it requires; the message names the space, the advice is to install a version of the extension that provides them, and the payload adds `spaceId`.

### MIGRATION.NO_MIGRATIONS

`migration show` was given a non-path reference but the app space has no migration packages at all, so there is nothing to resolve against. Create a migration with `prisma migration plan` first. Payload: none.

### MIGRATION.OPERATION_OPTION_REMOVED

A `migration.ts` passes an operation an option in the form an earlier version wrote, which this version no longer reads. `node migration.ts` strips types without checking them, so such a file runs; the operation refuses the option rather than leave out what it carries. Raised for a column default written as SQL text in `defaultSql`: by PostgreSQL `setDefault`, whose `column` is now `col(name, type, { default, codecRef })`, by SQLite `addColumn` and `recreateTable`, whose columns now carry `default` and `codecRef`; and by PostgreSQL `alterColumnType` given the `options` object an earlier version wrote (`qualifiedTargetType`, `formatTypeExpected`, `rawTargetTypeForLabel`, `using`), which now takes `{ schema, table, column, type, using? }`. The fix names the new form and the upgrade entry that shows it; if the migration is not applied, deleting its package and running `migration plan` again also works. Payload: `operation`, `option`, `upgradeEntry`.

### MIGRATION.OPERATION_UNSUPPORTED

A Mongo migration check uses a filter feature the check evaluator does not support: an unsupported filter operator, or an aggregation-expression filter. Payload: `operator`.

### MIGRATION.PACKAGE_NOT_FOUND

`migration show` or `migration check` resolved its target (a directory path, or a migration reference) but no loaded on-disk migration package matches it, either no package lives at the given path, or the resolved migration's package failed to load. `migration check` raises it at exit `2`: it could not run the check at all, which is different from running it and finding something. Pass a directory name, hash prefix, or path to an on-disk migration package, or inspect the migrations directory for corruption. Payload: none.

### MIGRATION.PATH_UNREACHABLE

An apply command (`db migrate`/`db update`) cannot find a path through the on-disk migration graph from the database's current marker to the requested target: the connecting edge was never planned. The fix walks you through `migration plan` (with the right `--from`/`--to`) then `db migrate`. `db init` and `db update` raise it too when the migrations an extension ships do not lead from the contract its space's marker names (the empty contract when it has none) to the extension's head ref: the message names the space, and the advice is to install a version of the extension whose migrations start where the database is, with the `migration list --space <id>` command that lists them. Payload: `spaceId`, `targetHash`, `kind` (`pathUnreachable`, or `neverPlanned` when no migration was ever planned), and for `pathUnreachable` `fromHash`, the contract the space's marker names, or `'empty'`, the empty contract's hash, when the space has no marker.

### MIGRATION.PLANNING_FAILED

Migration planning (typically during `db init`/`db update`) failed because of conflicts, e.g. the live database already contains objects that clash with the plan. The envelope aggregates each conflict's summary and suggested fix. Payload: `conflicts`; a conflict's `location` and `refusedStatement` leave out `namespaceId` for the unbound namespace, whose id is internal. A conflict of kind `statementRefused` refuses a `--rename` statement the planner cannot carry out, and carries that statement (`refusedStatement`, in namespace, model and field names): moving a model into the unbound namespace, which has no fixed schema; renaming or moving a table, or renaming a column, whose control policy is not `managed`; renaming a namespace with a table whose control policy is not `managed`, a namespace the starting schema does not have or whose new name it already has, Postgres's `public`, which Prisma owns and Postgres puts on every search path (the message says to move each model with `--rename <Model>:<new namespace>.<Model>` instead), or a schema another contract space also declares (the message names the space); a model with no table; a table or column the starting schema does not have, or already has under the new name, or a table the destination namespace already has; a field that has a column on one side of the statement only; a field rename on a model whose table changes when no statement renames the table (the message gives the steps: change the contract so only the table name changes and emit it, create a migration with `prisma migration new --from <hash of the migration the database is at>`, add `...this.renameTable(...)` to its operations and run its `migration.ts` with `node`, then emit the final contract and plan the field rename with `--from` that migration; with `db update`: change the contract so only the table name changes and emit it, rename the table in the database yourself with the SQL the message gives, check that `db update --dry-run` plans no drop of a table or column and run `db update`, then emit the final contract and run `db update` with the field statement); or a rename that produces an operation the command's operation policy does not allow. On MongoDB the planner refuses: renaming a namespace; renaming `_id`; renaming a variant whose discriminator value changes (the message says to keep the value with `@@base(<Base>, "<old value>")`); a field whose stored name contains `.` or starts with `$` (renaming from such a name says to rename it in the database yourself; renaming to one says to choose another stored name); renaming a time-series collection (the message says to create the new collection with the same time-series options, copy the documents and leave out the statement); renaming a field of a time-series collection, since MongoDB updates its documents only through the metaField (the message says to keep the field's stored name); removing a field of a time-series collection, a conflict of kind `fieldRemovalRefused` (the message says to keep the field in the contract, optional if new documents leave it out); renaming or removing a field of one root model in a collection that stores several root models without a discriminator, when another of them stores the same field and does not rename it to the same new name in the same plan (removal is a `fieldRemovalRefused` conflict; the message says to move the models to separate collections or carry out the change in a `dataTransform` operation with a filter); a collection the schema being planned from does not have, which includes a view; a collection rename onto a name the schema already has, or onto a name MongoDB rejects (empty, containing `$` or a null character, or starting with `system.`); a field stored in documents on one side of the statement only, or an embedded relation; a collection whose control policy is not `managed`; and a field rename whose collection changes with no statement renaming the model (when the model keeps its name, the message gives the steps: change only `@@map` and emit; with `db update`, rename the collection in `mongosh` and run `db update`; with `migration plan`, plan with `--delete <Model>`, make `renameCollection(...)` the first operation in its `migration.ts` and delete the drop, and the create if there is one, run its `migration.ts` with `node`, and apply it with `db migrate`; then rename the field). On Postgres and SQLite, enum values are compared by their stored values: an enum value rename is refused (`statementRefused`) when the destination enum still stores the old value under another member, as in `Cannot rename enum value "Status.ARCHIVED" to "Status.RETIRED": the destination enum still stores "archived", as enum value "Status.HIDDEN"`, since every row that holds it would change; a rename is refused the same way when another member of the origin enum already stores the new stored value and keeps it, as in `Cannot rename enum value "Status.ARCHIVED" to "Status.CLOSED": the origin enum already stores "done", as enum value "Status.DONE"`, since the rename would merge the data of the two members (renames that shift values along, where each value's member moves on in the same run, are planned, last value first); renames that move stored values in a cycle are refused, as in `Cannot rename enum value "Status.ACTIVE" to "Status.X": the renames move stored values in a cycle, "active" to "old" and "old" to "active", …`, and the message says to write the rewrites by hand in a `migration.ts` through a value no member stores, while the next action prints the `migration plan` command without those renames (the conflict's `leaveOut` lists them); and a removed or renamed enum value whose stored value is not a string or a number is refused (`unsupportedOperation`). `db init` applies only additive operations, so when a conflict is an operation its policy refused (the conflict carries `refusedOperationClass`), such as adding a validator to a Mongo collection that already holds documents, the error's next action depends on the refused classes. When `db update` allows all of them (`widening` and `destructive`), the next action is `db update`, which applies them, asking what each operation that would lose data means. When one is `data`, which `db update` does not apply, the next action is `migration plan`, to plan a migration that `db migrate` then applies.

`migration plan` raises it, as a conflict of kind `nothingToCreate`, when the planner produces no operations for a first migration: the contract describes nothing to create. If the database needs something the contract does not describe, run `prisma migration new` and write the operations in `migration.ts` by hand. `migration new` writes a migration only to the emitted contract, so with `--to` the message says to emit the target first. When there is an earlier contract, a plan with no operations is not refused: `migration plan` writes the migration with no operations and names the storage entities that changed, and `db migrate` applies it by moving the marker.

### MIGRATION.PLAN_NOT_ARRAY

An authored migration's `operations` getter returned something other than an array. Fix the migration class so `operations` returns an array of operations. Payload: `dir`, `actualValue` (when known).

### MIGRATION.PLAN_ORIGIN_UNKNOWN

`migration plan` or `migration new` was run without `--from` and without a `db` ref while migrations already exist on disk. Planning would silently fall back to an empty-database origin and produce a migration that recreates everything the existing history already creates, so the command refuses. Set the `db` ref (`migration ref set db <contract>` or `db update`), pass `--from <contract>`, or (for `migration plan`) pass `--from @empty` to deliberately plan from an empty database. Payload: `reachableRefs`.

### MIGRATION.POLICY_VIOLATION

A planned operation's class (e.g. `destructive`) is not allowed by the execution-time operation policy in force for the command. Runner-level failure during apply. Payload: `operationId`, `operationClass`, `allowedClasses`.

### MIGRATION.POSTCHECK_FAILED

After executing a migration operation, one of its postcheck steps (a query expected to return true) did not hold. Postgres and SQLite roll the apply back; on MySQL and MongoDB the operations that ran stay applied. The `why` says which check failed, after the operation ran; when the check states that one object must be absent or present, it names it, such as `After operation index.Item.Item_state_idx ran, it checks: verify index "Item_state_idx" exists. That check failed: the database has no index "Item_state_idx".` The SQLite check after a rebuild that a retyped column's values took the new type names the field (`failedTypeChange`) and the first value that kept its old storage class; it runs after a `--convert` copy expression too, and then `failedTypeChange.by` is `conversion` and its `reason` is `invalidResult`. When the step checks that a backfill left no row without a value (the postcheck of a Postgres backfill data transform, or a SQLite tightening rebuild), the runner counts the rows that still hold NULL (`rowsWithoutValue`), and the summary names the count, for example `1 row of "user" still holds NULL in "name" after its backfill step, so it cannot become required.` When the migration's own backfill step for the field left rows without a value (on Postgres, found by the postcheck of its data transform; on SQLite, where the step has no check of its own, by the rebuild that tightens the field), the summary says so, such as `1 row of "User" still holds NULL in "email" after its backfill step, so it cannot become required.`, and the advice says to make the step's run fill every row in that migration's `migration.ts`, run the file with `node`, and re-run `db migrate`. A failed cast or conversion is advised as for `MIGRATION.EXECUTION_FAILED`, and rows without a value as for `MIGRATION.PRECHECK_FAILED`. Payload: `failedCheck` (`operationId`, `phase`, `description`, and `expectation`, `{ expects, object }`, when the check states that one object must be absent or present), `databaseUnchanged`, and `failedTypeChange` or `rowsWithoutValue` when the step checked one.

### MIGRATION.POSTGRES_CONTROL_STACK_MISSING

A `PostgresMigration` operation (e.g. `createTable`, `dataTransform`) was invoked on an instance constructed without a control stack: normal CLI-driven runs always assemble one from `prisma.config.ts`, so this indicates a test fixture or ad-hoc consumer used the no-arg constructor (valid only for introspection). Payload: `operation`.

### MIGRATION.PRECHECK_FAILED

A check an operation runs before it changes anything did not hold, so the apply stops. Postgres and SQLite roll back; on MySQL and MongoDB the operations before it stay applied, and a re-run skips them.

`removeStoredValue` on a scalar column checks that the column takes NULL or that no row holds the value: `ensure column "status" of "task" takes NULL, or no row holds "archived" in it`. On a required column it fails while rows hold the value, and the apply changes nothing. When the call names its `enumValue`, as the planner's removal of a removed enum value does, the runner counts those rows: the message is `1 row of "task" holds "archived" in column "status", which takes no NULL, so the value cannot be removed.`, with the value as the database stores it, and the meta carries `rowsHoldingValue`: `enumValue` (a coordinate), `value`, `rows`, `operationIndex`, and `keepDataEdit`, the removal call as `migration.ts` writes it and the `replaceStoredValue` call to put in its place, whose new value is the placeholder `"<stored value>"`. A count that fails leaves the failure without `rowsHoldingValue`. The next actions give one way to keep that data each. Under `db update`: add a member to the enum in the contract source, run `contract emit`, and run `db update --rename 'Status.ARCHIVED:Status.<new member>'`; and, when no migration ends at the database's contract, change the stored value to one the enum keeps in the database yourself and run `db update --delete Status.ARCHIVED` again, or, when one does, plan the change with `migration plan --from <hash> --delete Status.ARCHIVED` and make the edit in the `migration.ts` it writes, since `db update` cannot keep that data by hand. Under `db migrate`: add the member, emit, delete the written migration and plan it again with the rename; or make the edit in its `migration.ts`, run that file with `node`, and run `db migrate` again.

The `why` names the operation and the check. When the check states the object it expects absent or present (`failedCheck.expectation`), it names it: `… That check failed: the database already has index "Item_state_idx". The failed apply changed nothing.` A check without one, such as one written before checks carried it, says `That check failed on this database.`

**No other cause found.** `db migrate` says why the database may not be where the migration expects. With no migration marker, it applies every migration from the first, so the database may already be ahead: adopt it with `db sign`. With a marker, the database has drifted: compare it with the contract using `db verify`.

**A column becoming required has rows without a value.** The runner counts them (`rowsWithoutValue`), for example `3 rows of "Item" hold NULL in "note", so it cannot become required.` The advice:

- `db update`: set the values, keep the field optional, or plan it with `migration plan --backfill <field>`.
- `db migrate`: set the values and re-run, keep the field optional, or plan the failed migration again with the printed `--backfill` flags.
- `db init`: initialize with the field optional, then run `db update`.

No command offers a default: one value in every row breaks a unique field, and a default does not fill rows that hold NULL. A planned migration must have its `migration.ts` run with `node` before `db migrate` applies it.

**A schema still holds objects.** On Postgres a schema drop checks that the schema holds no table, view, sequence, type or function, since it drops without `CASCADE`. When it does, the summary names them, such as `Schema "billing" still holds view billing.v_const, so it cannot be dropped.`, and the advice says to drop or move them in the database and re-run the same command with the same `--to` and statements.

**MongoDB renames.** A field rename stops when documents already hold the new name; the message gives the `mongosh` query that finds them. A collection rename stops when the new collection exists; the message says to drop it, or to make the rename the first operation of its `migration.ts`.

Payload: `failedCheck` (`operationId`, `phase`, `description`, and `expectation` when the check states one), `databaseUnchanged`, `rowsWithoutValue` or, on SQLite, `failedTypeChange` when the check found them, and `blockingObjects` (each `{ kind, name }`) for a schema that still holds objects. On MongoDB: `operationId`, and `name` for a field rename.

### MIGRATION.PROVIDED_INVARIANTS_MISMATCH

The `providedInvariants` stored in `migration.json` disagrees with the canonical value derived from `ops.json`: the manifest was likely hand-edited without re-emitting (a same-ids-different-order case is called out explicitly). Re-emit the package. Payload: `filePath`, `stored`, `derived`, `difference` (`{missing, extra}`).

### MIGRATION.REF_AMBIGUOUS

A contract or migration reference prefix matches more than one candidate (raised by the shared ref-resolution mapper used across CLI commands, and by `migration new --from` when the prefix matches several migration target hashes). Provide a longer prefix or the full hash. Payload: `input`, `candidates`, and at the shared-mapper site `grammar`.

### MIGRATION.REF_INVALID_FORMAT

A contract or migration reference is syntactically invalid: it is not a hash, ref name, or migration directory name in any accepted form (raised by the shared ref-resolution mapper). Payload: `input`.

### MIGRATION.REF_NOT_FOUND

A contract or migration reference does not resolve: no matching hash, ref name, or migration directory name exists in the migration graph or refs index (raised by the shared ref-resolution mapper used across CLI commands). Payload: `input`, `grammar`.

### MIGRATION.REF_NOT_RESOLVABLE

A ref name resolves to nothing: no pointer file with that name exists, and the fallback hash is not a node in the migration graph either, so there is no contract to materialize. Create the ref with `migration ref set`, advance it via `db update --advance-ref`, or pass a graph-node hash. Payload: `refName`, `identifier`.

### MIGRATION.REF_SET_BUNDLE_NOT_FOUND

`migration ref set` resolved the given hash to a graph node, but no on-disk migration bundle has that hash as its destination, so the ref would point at a node with no backing package. Re-emit the migration that produces this hash. Payload: `hash`.

### MIGRATION.REF_SET_EMPTY_SENTINEL

`migration ref set` was asked to point a ref at the empty-database sentinel hash, which is a planner internal and not a valid ref target. Use a real contract hash from the migration graph. Payload: `hash`.

### MIGRATION.REF_WRONG_GRAMMAR

A reference parsed, but as the wrong kind for the argument position, e.g. a migration-only reference where a contract reference is required (raised by the shared ref-resolution mapper). The message and fix come from the resolver's own diagnosis. `db sign` and `db update --to` raise it for the reserved references `@contract`, `@db`, and `@empty`, which they do not accept, and `migration plan --to @empty` raises it because `@empty` is only valid as an origin. Payload: `input`, `expectedGrammar`.

### MIGRATION.SAME_SOURCE_AND_TARGET

A migration's `from` and `to` hashes are identical and it declares no data-transform operations, a pure no-op self-edge, which is only allowed when the migration runs at least one `dataTransform`. Change the contract, add a dataTransform, or delete the migration. Payload: `dirName`, `hash`.

### MIGRATION.SCHEMA_VERIFY_FAILED

After applying migrations, the runner introspected the database and the resulting schema does not satisfy the destination contract. Postgres and SQLite roll the apply back; on MySQL, whose DDL commits as it runs, and MongoDB, whose operations are not wrapped in a transaction, the operations that ran stay applied. Either way the marker stays at its origin. `db init`, `db update` and `db migrate` report it with this code, and its `why` lists the issues ("The schema check after apply found: …"). `db migrate` names both possible causes, each as its own next action: when the contract source is wrong, change it to resolve the issues, re-emit, delete the failed migration's directory (after copying any code written in its `migration.ts`), plan it again, run its `migration.ts` with the printed `node` command, and re-run `db migrate`; when the migration's `migration.ts` does not reach its destination contract, for example after a hand edit, change its operations, run it with `node`, and re-run `db migrate`; `db update` and `db init` advise changing the contract source to resolve the issues listed, re-emitting and re-running the same command. An issue may carry an explanation, such as a raw SQL default the database stores in its own form: ``The database reads this default back as sql`(now() - '1 day'::interval)`; the contract declares sql`now() - interval '1 day'`. The database may store a default expression in its own form, so the two can mean the same. If they do, write the default as sql`(now() - '1 day'::interval)`.`` When no `sql` literal writes the database's text unchanged, the explanation suggests the trimmed text the database's parser reads, and when no literal writes that either, it says to change the default's SQL in the contract until the database stores it as written. Payload: `databaseUnchanged`, and `schemaIssues` (schema diff issues; an issue's `explanation` is `{ text, cause }`, with `cause` `differs` or `possibly-equivalent`).

### MIGRATION.SIGN_REFS_NOT_WRITTEN

`db sign` wrote the database markers, so the database is signed, but it could not write one or more refs or the contract snapshot of the app space afterwards, for example because the refs directory is not writable. The command still tries every ref, and the error names each one it could not write and why. It also names the spaces it did not sign: those whose schema failed verification and those whose marker changed while it ran. Fix what stopped the write and run `db sign` again with the same arguments: the markers already hold the contracts, so the second run writes only the refs. Payload: `signedSpaces`, `failedSpaces`, `conflictSpaces`, `unwrittenRefs` (each with `space`, `name`, `hash`, `reason`), `advancedRefs`.

### MIGRATION.SNAPSHOT_MISSING

A `--from` reference cannot produce a contract: either a ref name has no pointer file and the fallback hash is not a graph node (`viaRef: true`), or an explicit `--from <hash>` was given on an empty migration graph and names no ref (`viaRef: false`). Payload: `identifier`, `viaRef`. Also raised by `db sign` when a contract reference resolves to a hash but no migration produces that hash and the emitted contract does not match; that site has no meta.

### MIGRATION.SPACE_NOT_FOUND

`migration list --space <id>` (and similar space-scoped commands) named a contract space with no directory under `migrations/`. Distinct from an existing-but-empty space, which renders an empty state and exits 0. The envelope lists the space directories that do exist. Payload: `spaceId`, `availableSpaces`.

### MIGRATION.SQLITE_CONTROL_STACK_MISSING

SQLite twin of `MIGRATION.POSTGRES_CONTROL_STACK_MISSING`: a `SqliteMigration` operation needing the control adapter was invoked on an instance constructed without a control stack (only introspection is valid in that form). Payload: `operation`.

### MIGRATION.SQL_EXPRESSION_INVALID

A `migration.ts` writes SQL into a statement, and the text holds something that could end or extend that statement: the `using` of a Postgres `alterColumnType` call, which goes into the `USING` clause of `ALTER COLUMN … TYPE`, or a copy expression or temporary value of a SQLite `recreateTable` call, which goes into the `SELECT` that copies the old table's rows into the rebuilt table. Outside quoted literals and quoted identifiers, read by the target's quoting rules (Postgres: `'…'`, `E'…'` with backslash escapes, and `"…"`; SQLite: `'…'`, `"…"`, `` `…` `` and `[…]`), the text holds a semicolon, a SQL comment, dollar quoting, an unclosed quote, parentheses or brackets that do not match, or, outside parentheses and brackets, a comma or a keyword that would end the expression (`FROM`, `WHERE`, `UNION`, `INTERSECT`, `EXCEPT`, `GROUP`, `ORDER`, `HAVING`, `LIMIT`, `WINDOW`, `RETURNING`). A semicolon or keyword inside a quoted literal, such as `';'`, or inside parentheses, such as `(SELECT max("id") FROM "Other")`, is accepted, and so is `FROM` directly after `DISTINCT`, as in `"name" IS DISTINCT FROM 'al'`. The message names the call and what the text holds, for example `recreateTable({ tableName: "User" }): copyExpressions.age "0; DROP TABLE x" holds a semicolon outside a quoted literal, which could end or extend the INSERT … SELECT statement it is written into`. The check looks for these mistakes only; it does not check that the text is valid SQL. Raised when the call is built, so `migration.ts` writes no `ops.json`. Write the text as one SQL expression over the column, such as `CAST("age" AS INTEGER)`. If it holds a comma or a keyword such as `FROM` at the top level, wrap it in parentheses. Payload: `call`, `field`, `expression`, `refused`.

### MIGRATION.STATEMENT_ANSWERS_NO_QUESTION

It is the control API's form of `CLI.CONSENT_UNUSED`: the same condition, met where the engine does not check the flags. A program called the control API's `dbUpdate` or `executeMigrationPlanCommand` with `delete` or `allow` statements in `statements`, and some of them name no subject the plan asks about: no operation would lose that subject's data or, for `db update`, change who can read or write its data. `migration plan` asks no access questions, so an `allow` given to it always fails. Such a statement would consent to nothing, so the call fails before anything is written or applied, in plan mode as in apply mode. `db update --dry-run` raises it too, because a dry run asks nothing and hands its `--delete` and `--allow` values to the control API to check; an apply's unused flag is the engine's `CLI.CONSENT_UNUSED`. Leave the statements out, or name a subject the plan asks about. Payload: `statements` (each `{ verb, text }` that answered nothing), `subjects` (the subjects the plan asks about).

### MIGRATION.STATEMENT_DID_NOT_RESOLVE_LOSS

A `rename` typed at a data-loss question of `migration plan` or `db update`, or a `convert` typed at one of `migration plan`, was planned with the plan's other statements, and the plan still loses the data of the subject the question was about: the statement resolves, but it does not keep that data, for example because a rename renames a different model or field. Nothing is written or applied. Answer the question with `--delete <subject>` if the data may be lost, or with a statement that keeps that data, such as a rename whose old name stores it. Payload: `statement` (the statement's text), `verb` (`rename` or `convert`), `subject`.

### MIGRATION.STATEMENT_INVALID

A `--rename <old>:<new>` statement is malformed or pairs two things that cannot be renamed into each other: it has no `:` or more than one, a side has an empty name or more than three names, it names a model on one side and a field on the other, it names fields of two different models (a field cannot move between models), or an earlier statement in the same command already renames the same model or field, or renames another one to the same new name. It also refuses a statement that renames a model or field to itself (if only `@map` or `@@map` changed, a plan without the statement drops and creates the table or column with its data: with `migration plan`, edit the planned `migration.ts` to rename it instead, with `...this.renameTable(...)` or `...this.renameColumn(...)` on SQL; with `db update`, rename it in the database yourself first, then run `db update`, which then finds nothing that loses data), and two statements that swap names, which one plan cannot do: statements resolve against contracts, so the message gives the three plans that make the swap: the first name to a temporary name, the second name to the first, then the temporary name to the second. Every message's next step is the statement to type: the accepted forms with examples, or for a model on one side and a field on the other, both statements the user may have meant. Each side is one of `Model`, `namespace.Model`, `Model.field` or `namespace.Model.field`. A field's model is named as the destination contract names it: when the old side names the model by its old name, as in `--rename Profile:User --rename Profile.name:User.fullName`, the message gives the corrected statement, `--rename User.name:User.fullName`, and says when the model also needs its own `--rename`. A `--convert` or `--backfill` statement of `migration plan` is invalid when it names a model rather than a field, has a `:`, an empty name or more than three names, or names a field an earlier statement of the same verb already names; it is written `Model.field` or `namespace.Model.field`. A `--convert` and a `--delete` of the same field conflict, because each answers its type change differently: `--convert` converts each value with code written in `migration.ts`, and `--delete` lets the database cast each value; give one of them. Payload: `statement` (its text) and `verb` (`rename`, `convert` or `backfill`).

### MIGRATION.STATEMENT_NEEDS_MIGRATION_FILE

`db update` was given `--convert` or `--backfill`. Both statements ask for a migration file with a slot for code the user writes: the conversion of a field whose type changes, or the values a required field gets in existing rows. `db update` applies its plan directly and writes no migration file, so it refuses them before it plans anything. The control API's `dbUpdate` refuses `convert` and `backfill` statements the same way. Plan the change with `migration plan`, fill in the `migration.ts` it writes, run that file with `node` to write its operations, and apply it with `db migrate`: the message gives the `migration plan` command with every statement of the run it accepts (`--rename`, `--delete`, `--convert` and `--backfill`, in the order given, each quoted for a shell where needed), starting with `--from <hash>` when the database already exists and a migration on disk ends at the contract its marker names (the command opens only an existing database to read it, and never creates one); or run `db update` without these statements, and it asks before it loses any data. Payload: `statements` (each `{ verb, text }`).

### MIGRATION.STATEMENT_ORIGIN_UNKNOWN

Statements were given to `db update`, but it has no origin contract to resolve their old names against. When the database has no marker, Prisma has never initialised or updated it, so there is no earlier contract whose names a statement could rename: leave out the statements, and preview the plan with `--dry-run` first if the database already holds tables under the old names, because a plan without statements drops the storage of each renamed model or field with its data and creates it again (it asks for consent first). Otherwise the snapshot store has no contract for the marker's hash, or has one that cannot be read: its `contract.json` is not valid JSON, its content does not match the hash it is stored under, or the family cannot load the contract in it. The message names the hash and the directory it looked in. For an unreadable snapshot it says why, and the fix is to restore `migrations/snapshots/` from version control. A snapshot is missing when the run that last updated the database kept none: `db update` stores a snapshot of the contract it applies only when it advances a ref (the `db` ref by default, or with `--db <url>` only the ref named by `--advance-ref <name>`), so a database last updated with `--db <url>` and no `--advance-ref` usually has no snapshot. To store it, and for an unreadable snapshot with no good copy: put the contract source back to the version the database is at and run `contract emit`; run `db update --advance-ref <name> --dry-run` with the same `--db` and check that it plans no operations (if it plans some, the database has drifted from that contract), then run it without `--dry-run`, which changes nothing in the database and stores the snapshot; then put the new contract source back, emit it, and run the command with the statements again, with `--advance-ref <name>`. Adding `--advance-ref` to the failing command alone does not help, because it would store the new contract, and `migration plan --from` does not apply to `db update`. Payload: `hash` (`null` when there is no marker), `snapshotDirectory`, and `unreadable` when the snapshot could not be read.

### MIGRATION.STATEMENT_UNRESOLVED

A `--rename <old>:<new>` statement is well formed, but its names do not resolve in the contracts the way a rename requires. The old name must be a model (or a field of a model) in the origin contract and must not be in the destination contract; the new name must be in the destination contract and must not be in the origin contract. A field's model is named as the destination contract names it. A name without a namespace must be declared in exactly one namespace; a two-part name such as `a.b` must resolve as exactly one of `namespace.Model` and `Model.field`. A statement with one name on each side, such as `billing:finance`, reads as a namespace rename when the old name is a namespace of the origin contract: the destination must not have it, and the new name must be a namespace of the destination and not of the origin. When it reads both as a namespace rename and as a model rename, it is refused, and the message says to name the model with its namespace, `<namespace>.<Model>`. Value objects and their fields cannot be renamed in this release. Names match exactly, including case, and resolve against the application contract space only. A plan from an empty database (`migration plan --from @empty`, or a greenfield plan) has no models, so every statement is unresolved; running `db update` a second time with the same statements is unresolved too, because the database is then at a contract without the old names: the message says the rename has already happened and to leave out the statement. A statement written the wrong way round, whose new name is in the origin and old name in the destination, gets the statement written the right way round. A field statement whose model a later statement renames gets the order that works: the model statement first. The message names the contract searched and the names found there. A `--convert` or `--backfill` statement of `migration plan` names a field as the destination contract names it, after any rename; it is unresolved when the destination has no such model, namespace or field, when the field is a relation or a value object's, or when the destination model has no origin counterpart. A `--convert` is also unresolved when the origin has no such field and no rename gives it one, or when the field's type does not change; a `--backfill` when the field is optional in the destination or already required in the origin. Each message says what it found, and that the statement can be left out. Payload: `statement` (its text) and `verb` (`rename`, `convert` or `backfill`).

### MIGRATION.TABLE_NAME_CASE_CHANGED

The planner would drop table `X` and create table `Y` in the same namespace, where `X` is `Y` with its first letter lowered; the columns are not compared. That is the shape of a schema upgraded across the release in which a model with no `@@map` stopped lowering the first letter of its table name (`model UserProfile` now names `"UserProfile"`, previously `"userProfile"`); planning it would recreate the table empty. Reported as a conflict inside `MIGRATION.PLANNING_FAILED`. The message gives three ways out. Add `@@map("X")` to the model (or run the `add-model-map` codemod) to keep the existing table. In a project with migration history, make the rename its own schema change, create its migration with `prisma migration new --from <hash of the migration the database is at>`, and add `...this.renameTable({ table: "X", to: "Y" })` to its operations; the call renames the table and the constraints and indexes named after it, and on Postgres the message adds `schema: "<namespace>"` when the table is outside the default schema or another schema declares `X`. `migration new` defaults its origin to the `db` ref, so a project whose migrations are applied with `db migrate` has no origin to default to and must name one: pass the newest applied migration's `to` hash, which `prisma migration list` shows, or the command refuses with `MIGRATION.PLAN_ORIGIN_UNKNOWN`. In a project that uses `db update`, rename the table by hand with the statements the message gives, then run `db update` again: on Postgres `ALTER TABLE "<schema>"."X" RENAME TO "Y"`, and on SQLite, which refuses in one statement a rename that only changes the case of ASCII letters, `ALTER TABLE "X" RENAME TO "_prisma_rename_Y"; ALTER TABLE "_prisma_rename_Y" RENAME TO "Y"`. Payload: `droppedTable`, `createdTable`.

### MIGRATION.TABLE_RENAME_UNMATCHED

`this.renameTable({ table, to })` in a hand-written migration does not match the migration's contracts: the migration has no start contract, the start contract has no table `table` (or, with no `schema`, declares it in more than one namespace), the start contract already has a table `to`, or the end contract has no table `to`. Raised when the migration's operations are built, so `migration.ts` writes no `ops.json`. Make the rename its own schema change, so the migration's start contract is the schema before the rename and its end contract the schema after it, and check the table names and the `schema`. Payload: `from`, `to`.

### MIGRATION.TARGET_MISMATCH

A migration script declares one `targetId` but the loaded `prisma.config.ts` declares another; the script can only run against a config targeting the same database. Switch configs or pass `--config <path>`. Payload: `migrationTargetId`, `configTargetId`.

### MIGRATION.TARGET_NOT_APP_SPACE

A filesystem-path target given to a migration command does not resolve to an app-space migration directory: it points outside the app space's migrations directory, or at that directory's root itself. Pass an app-space migration directory or use a hash prefix. Payload: none.

### MIGRATION.TARGET_UNSUPPORTED

The configured target does not provide the migration support a command needs. Either it provides none (no planner/runner via `target.migrations`), so migration commands like `db init` cannot run against it, or it provides part of it and not the operation that was asked for. Select a target that provides the operation.

### MIGRATION.TEMPORARY_VALUE_INVALID

A SQLite `recreateTable` call in `migration.ts` has a `temporaryValues` entry that cannot be a temporary value. A temporary value fills a new required column in the existing rows, so it is refused for a column the old table already has (`schemaColumnNames`), where the copy would replace every value of it (`reason: 'existingColumn'`); to change those values, write a conversion in `copyExpressions` instead. It is also refused for a column that `copyExpressions` names too, which would be filled twice (`reason: 'alsoConverted'`); keep one of the two. Payload: `call`, `column`, `reason`.

### MIGRATION.UNFILLED_PLACEHOLDER

A scaffolded migration still contains a `placeholder(...)` call that the author never replaced with a real query; it throws when the migration is emitted or run. The `slot` names the exact location to edit (e.g. `"backfill-product-status:check.source"`). Payload: `slot`.

### MIGRATION.UNKNOWN_INVARIANT

A ref declares required invariants that no migration anywhere in the graph provides, either the ref has a typo or the providing migration has not been authored yet. Payload: `unknown`, `declared`, `refName` (when applicable).

### MIGRATION.UNKNOWN_REF

A ref name was used (read, resolved, or deleted via `migration ref` commands) but no ref file with that name exists. Create it with `prisma migration ref set <name> <hash>`, or run `migration ref list` to see what exists. Payload: `refName`, `filePath` or `availableRefs` depending on the site.

## PLAN

### PLAN.HASH_MISMATCH

When a plan runs or is rendered with `toSql`, its `meta.storageHash` does not match the storage hash of the contract it runs against: the plan was built against another contract, or another version of it. Rebuild the plan against the current contract. Payload: `planStorageHash`, `contractStorageHash`.

### PLAN.TARGET_MISMATCH

When a plan runs or is rendered with `toSql`, its `meta.target` does not match the target of the contract it runs against, e.g. a plan built for postgres passed to a sqlite client. Payload: `planTarget`, `contractTarget`.

## BUDGET

### BUDGET.ROWS_EXCEEDED

The `budgets` middleware blocks (or warns about) a query expected or observed to return more rows than the configured `maxRows` budget. Thrown before execution for an unbounded SELECT (no LIMIT, no aggregate-without-GROUP-BY) or when the AST-based row estimate exceeds the budget, and during row streaming when the observed row count crosses `maxRows`; raw-SQL guardrails also emit it for raw SELECT text without a LIMIT clause. Payload: `source` (`'ast'` or `'observed'`), `estimatedRows`, `observedRows`, `maxRows`.

### BUDGET.TIME_EXCEEDED

The `budgets` middleware reports after execution that a query's latency exceeded the configured `maxLatencyMs` budget. Default severity is warn (logged); it throws when the latency severity is configured as `error` or the runtime runs in strict mode. Payload: `latencyMs`, `maxLatencyMs`.

## LINT

### LINT.DELETE_WITHOUT_WHERE

The `lints` middleware found a DELETE plan with no WHERE clause and blocks execution to prevent an accidental full-table deletion. Default severity is error (throws); configurable to warn. Payload: `table`.

### LINT.NO_LIMIT

The `lints` middleware (or raw-SQL guardrails) found a SELECT with no LIMIT, which may return an unboundedly large result set. Default severity is warn (logged, execution proceeds); raw-SQL plans are checked heuristically against the SQL text. Payload: `table` (AST path) or `sql` snippet (raw path).

### LINT.READ_ONLY_MUTATION

Raw-SQL guardrails found a mutating statement (INSERT/UPDATE/DELETE/DDL) in a plan whose meta annotations declare a read-only intent (`read`, `report`, or `readonly`). Default severity is error (throws). Payload: `sql`, `intent`.

### LINT.SELECT_STAR

The `lints` middleware found a query that selects all columns, via the builder's selectAll intent on AST plans, or a literal `SELECT *` in raw SQL. Default severity is warn on the AST path, error on the raw path. Payload: `table` (AST path) or `sql` snippet (raw path).

### LINT.UPDATE_WITHOUT_WHERE

The `lints` middleware found an UPDATE plan with no WHERE clause and blocks execution to prevent an accidental full-table update. Default severity is error (throws); configurable to warn. Payload: `table`.

## PARADEDB

### PARADEDB.ARGUMENT_INVALID

A ParadeDB search-function helper received an invalid argument: a malformed query object, an out-of-range numeric option, or an option combination the function does not accept. Raised while authoring/lowering the search expression. Payload: `helper`, `argument`, `received`.

## POSTGIS

### POSTGIS.GEOMETRY_INVALID

A PostGIS geometry constructor (`point`, `polygon`, `bboxPolygon`, …) received invalid input: non-finite coordinates, a ring that is not closed, too few points, or a malformed bounding box. Raised at construction time, before the value reaches the database. Payload: `constructor`, `received`, `reason`.

## SUPABASE

### SUPABASE.CONFIG_INVALID

The Supabase extension's runtime configuration is invalid: missing or contradictory connection/auth settings, or a `pg` option that is not a `pg.Pool` (formerly the `SupabaseConfigError` class, removed at 0.17). Payload: `reason`.

### SUPABASE.JWT_INVALID

A JWT handed to the Supabase runtime failed validation: malformed token, missing claims, or signature/JWKS mismatch (formerly the `InvalidJwtError` class, removed at 0.17). Payload: `reason`.

## TESTKIT

Raised by the codec conformance testkits (`@internal/postgres-codec-testkit`, `@internal/sqlite-codec-testkit`) while running an extension author's conformance cases against a live database.

### TESTKIT.CODEC_DESCRIPTOR_MISSING

A conformance case names a codec id the target's built-in descriptor registry does not know, and the case supplies no descriptor of its own. The harness projects and decodes through the codec descriptor under test, so an extension codec must be supplied on the case. Payload: `codecId`.

### TESTKIT.CONFORMANCE_CASE_INVALID

A `many` conformance case carries a value that is neither an array nor null: the harness maps element-wise over array cases and has nothing to map over. Give the case an array of element values, or null.

### TESTKIT.PROJECTION_MALFORMED

The executed JSON projection came back in a shape the codec descriptor does not declare: the projected document is missing its value key, or an array projection produced something other than a JSON array or null. This points at the projection SQL the descriptor under test renders. Payload: `codecId` (when the case is known).
