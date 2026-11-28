# Survey of what scripts can depend on in the `prisma` command-line tool

Date: 2026-11-25. Written for project 13 of `projects/ga-compatibility/plan.md`. It records what each command offers to a script or an agent today, so the design can decide what to promise for 8.x.

Sources: this repository at branch `ga-compatibility`; shallow clones under `wip/survey/` of prisma/prisma-cli (commit `872b258`; `prisma` 8.0.0-rc.35, `@prisma/cli-engine` 0.10.4), prisma/composer (`@prisma/composer-cli` 0.40.0) and prisma/create-prisma. Everything comes from reading source and docs. No command was run.

## Where the commands come from

The `prisma` tool is built in prisma/prisma-cli, in `packages/cli/src/cli.ts`. That file mounts every command at a path it chooses. The products supply the commands:

- The ORM's 23 commands come from `@prisma/orm-toolchain/cli` (this repository, `packages/1-framework/3-tooling/cli`). The list is `createBinCommands` in `src/orm/cli.ts`. The target facades (`@prisma/orm-postgres` and the rest) have no command-line entry of their own: no `bin`, no command family. Everything a target adds reaches the user through these 23 commands (for example a target's `init` contribution, or the shape of `db schema`).
- Composer's 6 commands come from `@prisma/composer-cli`, in prisma/composer at `packages/9-public/composer-cli`. Four are defined in `packages/0-framework/3-tooling/cli/src/family/family.ts`, two in `packages/9-public/composer-cli/src/exports/family.ts`.
- prisma-cli defines 59 platform commands itself (auth, project, postgres, bucket, branch, git, service, skills, `init`, `feedback`).
- `@prisma/cli-engine` defines the 3 `telemetry` commands and the `--help` and `--version` flags.

That makes 91 commands. Every one is rendered by `@prisma/cli-engine`, so every one has the same four output forms: human text, data lines on stdout, JSON, and Markdown.

## What the engine gives every command

These facts apply to every row of every table below, so the tables do not repeat them.

### Flags the engine adds

From `packages/cli-engine/src/execution/shared-flags.ts` in prisma-cli. A command may not declare these names.

| Flag | Values and default | Effect |
|---|---|---|
| `--format` | `human`, `json`, `markdown`; default `human` | Chooses the output format |
| `--json` | boolean | The same as `--format json`; an explicit `--format` wins |
| `--log-level` | `error`, `warn`, `info`, `verbose`; default `info` | Filters messages, including JSON frames |
| `-v`, `--verbose` | boolean | `--log-level verbose` |
| `-q`, `--quiet` | boolean | `--log-level error` |
| `-y`, `--yes` | boolean | Accepts prompt defaults; never grants consent |
| `--confirm <token>` | repeatable | Grants one consent prompt |
| `--interactive`, `--no-interactive` | default: stdin is a terminal and no CI is detected | Forces prompts on or off |
| `--color`, `--no-color` | default: off under `NO_COLOR`, else follows whether stderr is a terminal; always off in Markdown | |
| `--config <path>` | default: `./prisma.config.ts` | |
| `--help`, `-h`, `--help-all`, `--version` | | |

Commands that ask statement questions also take `--delete`, `--rename` and `--allow` (the ORM's `migration plan` and `db update`).

The format is chosen only by a flag. A pipe, an environment variable or a detected agent never changes it. `@vercel/detect-agent` is used only to label telemetry.

### Environment variables the engine reads

`NO_COLOR`; `PRISMA_DEBUG`; `PRISMA_SERVICE_TOKEN` and `PRISMA_WORKSPACE_ID` (also passed on to child processes it starts); `PRISMA_DISABLE_TELEMETRY` and `DO_NOT_TRACK`; `PRISMA_TELEMETRY_ENDPOINT`; `XDG_CONFIG_HOME`, `HOME`, `APPDATA`, `USERPROFILE`. CI is detected with ci-info plus `BUILD_ID`, `BUILD_NUMBER`, `CI`, `CI_APP_ID`, `CI_BUILD_ID`, `CI_BUILD_NUMBER`, `CI_NAME`, `CONTINUOUS_INTEGRATION` and `RUN_ID`; `CI=false` turns detection off. The prisma-cli shell adds `PRISMA_CLI_STATE_DIR`, `NO_UPDATE_NOTIFIER`, `PRISMA_CLI_UPDATE_CHECK_*`, `XDG_CACHE_HOME` and `LOCALAPPDATA`.

### Exit codes the engine sets

From `src/execution/settlement.ts` and `src/execution/engine.ts`.

| Code | When |
|---|---|
| 0 | Success, `--help`, `--version`, a bare group |
| 1 | `CLI.INTERNAL_ERROR`: an unexpected throw, or a handler returning a code it did not declare |
| 2 | Every structured error: usage errors (`CLI.INVALID_ARGUMENTS`, `CLI.UNKNOWN_COMMAND`), redirects (`CLI.COMMAND_MOVED`, `CLI.V7_COMMAND`, `CLI.V7_FLAG`), consent errors, and every product error |
| 3 | `CLI.PROMPT_CANCELLED`, or `CLI.ABORTED` without a signal |
| 4 to 99 | Codes a command declares with `exitCodes` |
| 130, 143 | SIGINT, SIGTERM |
| a child's status | Commands that start a child process pass its status through |

The engine's own error codes are listed in prisma-cli `docs/reference/error-reference.md`, CLI section.

### The JSON output

stdout carries newline-delimited JSON. Each line is an event frame with `kind`, `commandId` and `timestamp`. Kinds: `step-started`, `step-finished`, `progress`, `message`, `output`, `remediation`, `endpoint`, `status`, `artifact`. The last line is always one `result` frame:

```json
{ "kind": "result", "commandId": "migration.status", "timestamp": "…", "envelope": { "ok": true, "commandId": "migration.status", "result": { … }, "exitCode": 0, "diagnostics": [], "nextActions": [] } }
```

On failure the envelope is `{ ok: false, commandId, error: Diagnostic, diagnostics, nextActions }`, with no `exitCode`. A diagnostic is `{ code, severity, summary, why?, nextActions, where?: { path?, line? }, meta?, docsUrl? }`. Absent optional fields are left out.

The command's own document is `envelope.result`. Each product chooses its shape. The engine's types (`StreamEvent`, the two envelopes, `Diagnostic`, `NextAction`) are TypeScript types exported from `@prisma/cli-engine`. There is no JSON Schema. No frame or envelope carries a format version. `@prisma/cli-engine/protocol` also exports `CliErrorEnvelope`, a flat `{ ok: false } & Diagnostic` that the engine never writes.

Frames are filtered by log level, so `--quiet --json` drops `info` and `warn` frames.

### The Markdown output

Selected only by `--format markdown`. Code: `src/execution/markdown.ts`. Everything goes to stdout, errors and help included. Data lines are not printed.

- Each human block becomes Markdown: a summary as `[ok] text`, fields as `label: value`, tables as GFM pipe tables (or `(no rows)`), lists and trees as nested items, drawings in fenced blocks. Then `### Next` with the next actions and `### Diagnostics`.
- An error starts `[error] CODE: summary`, then `why:`, `where:`, the next actions and `docs:`.
- Help becomes `# name`, `## Usage`, `## Commands`, `## Options`, `## Global options`, `## Examples`.
- Events become one line each; step starts, progress and remediation events are dropped.
- Table cells escape `\`, `|` and newlines. Code spans use one more backtick than the longest run inside.

So the Markdown carries the same facts as the human output, not the JSON document. No document says which parts are stable. prisma-cli `docs/product/output-conventions.md` describes it without a promise. Two shell notices still go to stderr under Markdown: the update notice and the deprecated-variable warning.

### Data lines

A command's presentation has a `stdout` function that returns its lines, or `noDataLines(reason)`. The engine writes them in human format only, and leaves them out when stdout and stderr are the same terminal. The engine does no escaping: it writes each line as the command gives it. The ORM escapes in its own helpers (`src/orm/data-lines.ts`); Composer documents escaping; the platform commands do not escape.

### Help

`--help` prints a human card to stdout, or Markdown under `--format markdown`. Under `--json`, help goes to stderr and stdout is empty. There is no machine-readable list of commands or flags. The engine builds help from an internal `HelpCard` structure but never emits it as data.

### Maturity

No command in any repository states a maturity level. The engine has no field for one.

## Repository 1: prisma/orm (the ORM's commands)

Source: `packages/1-framework/3-tooling/cli/src/orm/`. Published as `@prisma/orm-toolchain/cli` (the `ormCommandFamily` export). Paths in the table are relative to that `src/` folder.

Shared facts for this table:

- **Exit codes**: the engine's, plus the 4 and 5 codes named in the row. Only `migration check` has the exported module the Style Guide requires (`commands/migration-check/exit-codes.ts`, not on the package surface). `orm init`, `db verify` and `db sign` declare theirs inline.
- **Environment**: commands that take `--db` fall back to `config.db.connection`, which the user's config usually reads from `DATABASE_URL`. `db migrate` reads CI detection (it advances no ref in CI). Glyphs read `LC_ALL`, `LC_CTYPE` and `LANG`.
- **`--json` document**: the TypeScript type named in the row, in that file. Almost every document carries its own `ok` field inside the engine's envelope, and most carry a prose `summary`.
- **Published?**: only `orm init`'s schema is published (`@prisma/orm-toolchain/cli/init-output`, arktype `InitOutputSchema`). Arktype schemas for six migration commands exist in `commands/json/schemas.ts` but are not exported. Some result types are exported as TypeScript types from `@prisma/orm-toolchain/cli/control-api` (for example `MigrationPlanResult`), as the result of the programmatic API, not as the CLI's format.
- **Data lines**: documented in the package README, "Piped Output", which says they are "a stable interface, like `--json`".
- **Maturity**: none stated.

| Command | Positionals and flags | Exit codes | `--json` document (where defined) | Data lines | Files written for programs | Known readers |
|---|---|---|---|---|---|---|
| `orm init` | `--target`, `--authoring`, `--schema-path`, `--write-env`, `--probe-db`, `--strict-probe`, `--skip-install`, `--keep-previous-facade`, `--from-prisma7-schema`; consent by `--confirm <dir name>` | 4 install failed; 5 scaffolded and installed, emit failed | `InitOutput` (`commands/init/output.ts`): `ok`, `target`, `package`, `authoring`, `schemaPath`, `filesWritten`, `filesDeleted`, `filesRenamed`, `packagesInstalled{status,deps,devDeps}`, `contractEmitted`, `prisma7`, … Published. Reads `DATABASE_URL` for `--probe-db`, `npm_config_user_agent` and `npm_config_registry`. | Paths of files written | none (it scaffolds source files) | create-prisma `src/tasks/prisma-setup/commands.ts` (runs it with `--json --yes --target --authoring --schema-path --skip-install [--confirm]`; reads the envelope, not `target` or `package`) |
| `contract emit` | `--output-path` | engine only | `EmitDocument` (`contract/emit.ts`): `ok`, `storageHash`, `executionHash?`, `profileHash`, `outDir`, `files{json,dts}`, `pinnedFiles[{spaceId,path}]`, `timings`. No `summary`. | Paths of `contract.json`, `contract.d.ts`, then pinned extension files | `contract.json`, `contract.d.ts` (read by the runtime; covered by project 2) | create-prisma `setup-prisma.ts` (envelope only) |
| `contract print` | `--output` | engine only | `PrintDocument` (`contract/print.ts`): `ok`, `summary`, `target{familyId,id}`, `psl{path}` or `psl{text}`, `source`, `sourceSettings`, `timings` | The PSL itself, unescaped, when no `--output` | the PSL file | none found |
| `contract format` | none | engine only | `FormatOperationResult` (`control-api/operations/format.ts`): `formatted`, `paths`. No `ok`, no `summary`. | Paths formatted | rewrites PSL files | none found |
| `contract infer` | `--db`, `--output` | engine only | `InferDocument` (`contract/infer.ts`): `ok`, `summary`, `target`, `psl{path}`, `meta{dbUrl?}` (masked), `timings` | Path of the PSL written | the PSL file | none found |
| `db init` | `--db`, `--dry-run`, `--advance-ref` | engine only | `MigrationCommandResult` (`utils/formatters/migrations.ts`): `ok`, `mode`, `plan{targetId,destination,operations,preview?}`, `execution?`, … | none (`noDataLines`) | ref and snapshot files | none found |
| `db update` | `--db`, `--dry-run`, `--to`, `--advance-ref`, `--permit-policy-change`; statements `--delete`, `--rename`, `--allow` | engine only | `MigrationCommandResult`, as `db init` | none (`noDataLines`) | ref and snapshot files | skill `skills/prisma-8/references/migrations.md` (`db update --json`) |
| `db migrate` | `--db`, `--to`, `--advance-ref`, `--no-advance-ref`, `--show`, `--from` (with `--show`), `--permit-policy-change` | engine only | `MigrateDocument` (`migrate.ts`): `ok` (boolean), `migrationsApplied`, `migrationsTotal`, `markerHash`, `applied[{spaceId,dirName,migrationHash,from,to,operationsExecuted}]`, `summary`, `perSpace`, `pathDecision?`, `timings`, `advancedRef?`, `databasePoliciesUpdated?`. With `--show`: `MigrateShowDocument` `{ok, migrations, summary}` | Per applied migration: space, name, from, to, operations. With `--show`: space, name, from, to | ref and snapshot files | Composer deploy calls the control API, not the command |
| `db schema` | `--db` | engine only | `SchemaDocument` (`db/schema.ts`): `ok`, `summary`, `target`, `schema` (typed `unknown`: its shape depends on the database family), `meta{dbUrl?}`, `timings` | none (`noDataLines`) | none | none found |
| `db sign` | `[contract]` or `--contract`, `--db`, `--advance-ref`, `--no-advance-ref` | 4 a space failed verification and was not signed | `DbSignDocument` (`db/sign.ts`): `ok` (boolean), `summary`, `spaces[]`, `advancedRefs[{space,name,hash}]` | Per space: space, status, storage hash | marker in the database; ref and snapshot files | none found |
| `db verify` | `--db`, `--marker-only`, `--schema-only`, `--strict` | 4 drift or marker findings | `DbVerifyDocument` (`db/verify.ts`): the verify report plus `ok` (boolean); `--schema-only` gives a different document, `SchemaVerifyDocument` | none (`noDataLines`: "the result is its exit code") | none | skill `debug.md` (exit 4) |
| `migration plan` | `--name`, `--from`, `--to`; statements `--delete`, `--rename`, `--allow` | engine only | `MigrationPlanResult` (`control-api/operations/migration-plan.ts`; exported as a type from `/cli/control-api`): `ok` (boolean), `noOp`, `from`, `to`, `dir?`, `baselineDir?`, `emittedExtensionDirs[{spaceId,dirName}]`, … | Directories written, baseline first | migration packages (`migration.json`, `ops.json`; project 2) | create-prisma `setup-prisma.ts` (envelope only) |
| `migration new` | `--name`, `--from` | engine only | `MigrationNewResult` (`control-api/operations/migration-new.ts`): `ok`, `dir`, `from`, `to`, `summary` | The directory written | a migration package | none found |
| `migration show <target>` | positional `target` | engine only | `MigrationShowResult` (`commands/json/schemas.ts`, arktype, not exported) | `key<TAB>value` lines, then `operation<TAB>id<TAB>class<TAB>label` | none | none found |
| `migration status` | `--db`, `--space`, `--to`, `--from`, `--legend`, `--ascii` | engine only; findings are `warn` diagnostics at exit 0 | `MigrationStatusJsonResult` (`commands/json/schemas.ts`, not exported); its own `diagnostics` use `message` and `hints`, not `summary` and `nextActions` | Per migration: space, name, from, to, operations, status | none | skill `debug.md` (reads `spaces[].currentContract`, `migrations[].status`) |
| `migration list` | `--space`, `--ascii`, `--legend` | engine only | `MigrationListResult` (`commands/json/schemas.ts`, not exported) | Per migration: space, name, from, to, operations | none | none found |
| `migration log` | `--db`, `--utc`, `--ascii` | engine only | `MigrationLogResult` (`commands/json/schemas.ts`, not exported) | Per applied migration: applied at, space, name, from, to, operations | none | none found |
| `migration graph` | `--space`, `--dot`, `--ascii`, `--legend` | engine only | `MigrationGraphJsonResult` (`commands/json/schemas.ts`, not exported); with `--dot` adds the DOT text | Per migration: space, name, from, to; with `--dot`, the DOT text unescaped | none | none found |
| `migration check [target]` | positional `target`, `--space` | 4 integrity failures | `MigrationCheckResult` (`commands/json/schemas.ts`, not exported); failures `{space,code,where,why,…}` with `where` a string | Per failure: space, code, where | none | none found |
| `migration ref list` | none | engine only | `RefListResult` (`control-api/operations/ref.ts`): `ok`, `refs` (an object keyed by name) | Per ref: name, hash, invariants (comma-separated) | none | none found |
| `migration ref set <name> <contract>` | positionals `name`, `contract` | engine only | `RefSetResult`: `ok`, `ref`, `hash`, `invariants`, `policies?` | The hash | the ref file and snapshot (project 2) | `migrations.md` (as next action) |
| `migration ref delete <name>` | positional `name` | engine only | `RefDeleteResult`: `ok`, `ref`, `deleted` | none (`noDataLines`) | removes the ref file | `migrations.md` |
| `lsp` | `--stdio`, `--clientProcessId <pid>` | the server's own | none: speaks the Language Server Protocol on stdio | none (stdio is the protocol) | none | editor extensions (the VS Code client passes `--clientProcessId`) |

Docs and rules in this repository: `docs/CLI Style Guide.md` (exit codes, data lines, "JSON Semantics", error envelope) and the package README ("Piped Output", per-command sections). Errors link to `https://docs.prisma.io/docs/orm/v8/reference/error-reference#<CODE>` (`DOCS_BASE` in `packages/1-framework/0-foundation/utils/src/structured-error.ts`).

## Repository 2: prisma/composer (`@prisma/composer-cli`)

Paths are relative to the composer repository root. Shared facts: no command declares its own exit codes, so all use the engine's; no maturity is stated (the package is 0.40.0); cloud commands read `PRISMA_SERVICE_TOKEN` and `PRISMA_WORKSPACE_ID`. Errors link to `https://www.prisma.io/docs/cli/error-reference/`. Composer's prose `fix` becomes one `user-choice` next action (`cli/src/family/translate-error.ts`).

| Command | Positionals and flags (defaults) | Environment | Exit codes | `--json` document (where defined, published?) | Data lines | Files written for programs | Known readers |
|---|---|---|---|---|---|---|---|
| `deploy` | `--entry`, `--name` (root module's name), `--environment` (`production`), `--report <path>`, `--build-id`; `--stage` is retired (`CLI.COMMAND_MOVED`) | `PRISMA_COMPOSER_REPORT_FILE`, `PRISMA_BUILD_ID`, `PRISMA_REGION`, `PRISMA_API_URL`, `PRISMA_MANAGEMENT_API_URL`, `GITHUB_ACTIONS` | engine's; Ctrl-C reports `DEPLOY.INTERRUPTED` then exits 130; a report it cannot write still exits 0 | Progress frames, then `{ summary: { app, nodes[{address, entities[{kind,id,url?,details?}]}], findings{unset} } or null, durationMs }` (`cli/src/family/commands/deploy.ts`, `cli/src/deployment-summary.ts`). TypeScript types from `@prisma/composer/control`; no JSON Schema | Per entity: address, kind, id, URL | the report file (below) | create-prisma `src/tasks/composer/deployment-result.ts` and `deploy-report.ts`; `scripts/e2e-first-deploy.ts`; `examples/root-input/scripts/smoke.ts`; the Prisma GitHub deploy action |
| `deploy list` | `--entry`, `--name`, `--environment` (`production`) | as above | engine's; nothing deployed is `DEPLOY.TARGET_NOT_FOUND` (2) | A bare array of `{address, kind, platformId or null, url or null}`; type `DeployedNode` exported from `@prisma/composer-cli/family` | Per node: address, kind, platform id, URL | none | `scripts/deploy-list-check.ts`, `scripts/e2e-verify-deploy-list.ts`, `.github/actions/deploy-verify-destroy/action.yml` |
| `dev` | `--entry`, `--name`, `--environment` (`dev`), `--fresh`, `--detach`; Prisma 7 flags fail with `CLI.V7_FLAG` | `PRISMA_COMPOSER_EMULATORS_DIR`, `PRISMA_COMPOSER_SERVICE_READY_TIMEOUT_MS` | engine's; Ctrl-C exits 130 even after a clean stop | Event frames, then `result: null`; no type | none, and no `noDataLines` reason | internal state under `.prisma-composer/` and `~/.prisma-composer/`, not documented for programs | none found |
| `dev url <address>` | positional `address`; `--environment` (`dev`) | as `dev` | engine's | `{address, kind, url, state, runs?}`; type `DevUrl` from `@prisma/composer/control` | The URL | none | `docs/guides/running-locally.md` (`$(prisma dev url …)`) |
| `dev stop` | `--entry`, `--name`, `--environment` (`dev`) | as `dev` | engine's; 0 when nothing ran | `{app, environment, stopped[{address, kind}]}`; type `DevStopped` from `@prisma/composer/control` | Per node: address, kind | none | docs only |
| `emulator list` | none | `PRISMA_COMPOSER_EMULATORS_DIR` | engine's | `{emulators[{kind, running, url, instances[…], error}]}`; type `EmulatorList` not exported | Per instance: kind, id, URL, state, address, directory, environment | none | docs only |

**The deploy report file.** Type `RunReport` in `packages/0-framework/3-tooling/cli/src/run-report.ts`, with `RUN_REPORT_VERSION = 2`. Exported as TypeScript types from `@prisma/composer/control`. No JSON Schema and no published sample. Format: `{ version: 2, outcome: 'succeeded'|'failed', app, environment, nodes[{address, entities[{kind,id,url?,details?}]}], failure: {code, message} or null }`. The code comment says every field is always present with `null` for absent; entities break that by leaving out `url` and `details`. The rule for the version is "bump when a change would break a consumer". The only recorded change from 1 to 2 is `stage` renamed to `environment` (`docs/guides/deploying.md`). It is written on a returned failure (with `nodes: []`) but not when the engine's own checks fail first, when the deploy code cannot load, on a crash, or when the file cannot be written. `docs/design/05-prisma-cloud/build-reporting.md` calls the file transitional. Readers: create-prisma `deploy-report.ts` (requires `version` 2, reads `failure.code`), `examples/root-input/scripts/smoke.ts`, the GitHub deploy action.

**Rules written in Composer.** Data lines: tab-separated, escaped, empty for absent, append only (`docs/guides/running-locally.md#piped-output`, `docs/design/90-decisions/ADR-0053-dev-url-dev-stop-and-emulator-list.md`). Exit codes: ADR-0044. JSON results are described in ADR-0053 but nothing promises they are stable. The emulator registry files are a contract across Composer versions (ADR-0053).

## Repository 3: prisma/prisma-cli (the tool's own commands and the engine)

Paths are relative to the prisma-cli repository root. Shared facts: no command declares its own exit codes; no maturity is stated; every `--json` result type lives in unexported source in `@prisma/cli` (which exports only `./src/bin` and `./package.json`), so none is published and there is no JSON Schema. "creds" means `PRISMA_SERVICE_TOKEN`, `PRISMA_WORKSPACE_ID`, `PRISMA_AUTH_FILE` (or the deprecated `PRISMA_COMPUTE_AUTH_FILE`), `PRISMA_MANAGEMENT_API_URL`, `PRISMA_AUTH_BASE_URL`. Six list commands share the shape `{context, items[{name, id, status}], count}` from `packages/cli/src/output/patterns.ts` (`project list`, `project env list`, `bucket list`, three postgres lists); other lists have their own shapes (`auth workspace list` items carry `workspaceId`, `workspaceName`, `current`).

| Command | Positionals and flags | Environment | `--json` result (source) | Data lines | Files written for programs | Known readers |
|---|---|---|---|---|---|---|
| `--version` (engine) | | | `{version}` | The bare version | none | none found |
| `--help` (engine) | | `NO_COLOR` | none: help goes to stderr under `--json` | none (help on stdout) | none | none |
| `auth login` | `--ui-context prisma-plugin` | creds, `CI` | `auth/login.ts` | yes | `<config>/prisma/auth.json` | create-prisma `auth.ts`; the Prisma ChatGPT plugin passes `--ui-context` |
| `auth logout` | | creds | `auth/logout.ts` | none | auth.json | |
| `auth whoami` | | creds | `WhoamiResult` (`auth/whoami.ts`); signed out is exit 0 with `authenticated: false` | `key<TAB>value` | none | create-prisma `auth.ts` (`authenticated`, `workspace`, `source`) |
| `auth workspace list` | | creds | `auth/workspace-list.ts` | workspace, user, id, status | may update auth.json | create-prisma `auth.ts` (`items[{workspaceId, workspaceName, current}]`) |
| `auth workspace use [id-or-name]` | | creds | `auth/workspace-use.ts` | yes | auth.json | create-prisma `auth.ts` (`workspace`) |
| `auth workspace logout <id-or-name>` | | creds | `auth/workspace-logout.ts` | none | auth.json | |
| `project list` | | creds | `{context, items, count, localBinding}` (`presenters/project.ts`) | rows | none | create-prisma `projects.ts` (`items[{id, name}]`) |
| `project show [project]` | | creds | `project/show.ts` | `key<TAB>value` | none | create-prisma `projects.ts` (`workspace`, `project`) |
| `project create <name>`, `project link [project]` | `--region` (create) | creds | `project/presentation.ts` | the project id | `.prisma/local.json`; `.gitignore` | |
| `project rename`, `delete`, `transfer` | `--project`; `--confirm`; `--to-workspace`, `--recipient-token` | creds | `project/*.ts` | none | none | |
| `project env add`, `update`, `list`, `delete` (4) | `--file`, `--role production\|preview`, `--branch`, `--project` | creds | `project/env-*.ts` | `add`, `list`: yes | none | |
| `postgres list`, `show`, `create`, `usage`, `delete` (5) | `--project`, `--branch`, `--region`, `--from`, `--to` | creds | `postgres/*.ts`; `create` shows the secret once | rows; `create`: the connection URL | none | |
| `postgres backup list`, `restore` (2) | `--limit`; `--backup`, `--source-database` | creds | `postgres/backup-*.ts` | `list`: rows | none | |
| `postgres connection list`, `create`, `rotate`, `delete` (4) | `--name`, `--project`, `--branch` | creds | `postgres/connection-*.ts` | rows; the URL | none | |
| `bucket list`, `create`, `delete` (3) | `--project`, `--branch`, `--name` | creds | `bucket/*.ts` | rows; yes | none | |
| `bucket key list`, `create`, `delete` (3) | `--role read\|read_write`, `--name` | creds | `bucket/key-*.ts` | `create`: dotenv `S3_*=` lines | none | |
| `branch list` | `--project` | creds | `branch/list.ts` | rows | none | |
| `git connect [git-url]`, `git disconnect` (2) | `--project` | creds, `PRISMA_CLI_GITHUB_INSTALL_*` | `git/*.ts` | none | none | |
| `service list`, `show`, `open`, `create`, `delete` (5) | `--project`, `--branch`, `--region` | creds | `service/results.ts` | rows; `key<TAB>value`; the URL; the id | none | |
| `service logs <svc>` | `--version-id`, `--tail` (100), `--from-start`, `--follow` | creds, `PRISMA_CLI_SERVICE_LOGS_POLL_MS` | log lines as `output` frames, result `null` | log lines | none | |
| `service version list`, `show`, `promote`, `rollback`, `start`, `stop`, `delete` (7) | `--to` (rollback), `--project`, `--branch` | creds | `service/results.ts` | `list`, `show`: yes | none | |
| `service domain add`, `show`, `delete`, `retry`, `wait` (5) | `--service`, `--project`, `--branch`, `--timeout` (15m) | creds, `PRISMA_CLI_DOMAIN_WAIT_POLL_MS` | `service/results.ts` | DNS rows; `key<TAB>value`; the URL | none | |
| `skills sync` | `--enable`, `--disable` | `PRISMA_SKILLS_CHECK` | `SkillsSyncResult` (`skills/results.ts`) | rows | skill folders; `.prisma/skills.json` | the `postinstall` script root `init` writes: `prisma skills sync \|\| exit 0` |
| `skills list` | | `PRISMA_SKILLS_CHECK` | `SkillsListResult` | rows | none | |
| `init` (root) | `--postinstall`, `--no-postinstall`, `--skills <agents\|none>` | | `InitResult {postinstall, config, skills}` (`commands/init.ts`) | none | `prisma.config.ts`, `package.json`, skill folders | create-prisma `commands.ts` (`init --yes --skills=…`) |
| `feedback <message>` | `--email` | `PRISMA_CLI_FEEDBACK_URL` | `commands/feedback.ts` | none | none | |
| `telemetry status`, `enable`, `disable` (3, engine) | | `PRISMA_DISABLE_TELEMETRY`, `DO_NOT_TRACK`, CI variables | `TelemetryStatus {enabled, reason, configPath, installationIdStored}` (`cli-engine/src/telemetry/commands.ts`) | `status`: `key<TAB>value` | `<config>/prisma/config.json` | |
| Prisma 7 redirects: `bootstrap`, `version`, `debug`, `mcp`, `complete`, `platform status`, `postgres link`, old `init` flags | | | error `CLI.V7_COMMAND` / `CLI.V7_FLAG`, exit 2 | | | |

**Rules written in prisma-cli.** ADR 0003 (`docs/architecture/adrs/0003-structured-output-and-errors.md`): output and errors are public contracts, programs branch on fields. `docs/product/output-conventions.md`: data lines are stable. `docs/product/error-conventions.md`: branch on `error.code`. `docs/architecture/cli-engine-requirements.md`: R5 only the engine renders; R6 exit codes; R10 the config marker `$prismaConfig` is versioned; R11 exact engine pins. ADR 0004: products pin the engine exactly; a range waits for "a written engine compatibility contract" after GA, which does not exist. `docs/oss/versioning.md`: RC releases may break until 8.0.0. Checks: `packages/cli/tests/golden-rendering.test.ts` fixes the bytes of one example per rendering surface; `check:grammar` proves every exported command is mounted; `check:error-reference` checks the error registry. Nothing compares flags, command paths, JSON fields, data lines or Markdown with an earlier release.

## Readers found

- **create-prisma** runs `orm init`, `init`, `contract emit`, `migration plan`, `auth whoami`, `auth login`, `auth workspace list`, `auth workspace use`, `project list`, `project show` and `deploy`, always with `--json` (`src/tasks/prisma-cli.ts`). It takes the last line, unwraps `envelope` from a `result` frame, and also accepts a bare envelope and a `command` field the engine no longer writes. Its diagnostic schema accepts `message` as well as `summary`. It decodes result fields with Effect schemas for the auth, project and deploy commands. It reads the deploy report's `failure.code` and requires `version: 2`. Its tests use hand-written documents.
- **The `prisma-8` skill** (`skills/prisma-8/references/debug.md`, `migrations.md`): describes the CLI error as the flat `CliErrorEnvelope` with `fix`, which is not what the wire carries; reads `migration status --json` fields (`spaces[].currentContract`, `migrations[].status`); relies on exit codes 2, 3 and 4; tells agents to use `--json` or `-v`. It never mentions `--format markdown`.
- **Composer's own scripts and examples** read `deploy`, `deploy list` and the report (listed in the Composer table). The Prisma GitHub deploy action reads the report.
- **Users' `package.json`**: root `init` writes `prisma skills sync || exit 0` as a `postinstall` script, so that path and its exit code are depended on by every project it set up.
- **Editors** spawn `prisma lsp --stdio --clientProcessId <pid>`.
- The repository skills under `skills-contrib/` are for contributors to this repository and drive no `prisma` command.

## Issues a design must settle

Counts are of the 91 commands (23 ORM, 6 Composer, 62 prisma-cli including the 3 engine `telemetry` commands) unless the line says otherwise.

1. **Two `ok` fields with different meanings (21 ORM commands).** The engine envelope's `ok: true` means the command completed. Inside `result`, 21 ORM commands repeat `ok`. In `db migrate`, `db sign`, `db verify`, `migration plan` and `migration check` the inner `ok` is a boolean that can be `false` while the envelope says `true`. Composer and platform results have no inner `ok`.
2. **Prose inside documents (about 17 ORM commands).** Most ORM documents carry a `summary` sentence. A script cannot depend on prose, and it changes whenever wording improves. `contract emit`, `contract format`, `orm init` and the three `migration ref` commands have none.
3. **Different names for the same thing (at least 9 ORM commands, 4 Composer commands).** ORM: `db migrate`, `migration plan` and `contract emit` say `spaceId`, `dirName`, `migrationHash`; `migration list`, `status`, `log`, `graph`, `show` and `check` say `space`, `name`, `hash`. Composer calls a database `postgres` (`deploy list`), `database` (`dev stop`, `emulator list`) and `postgres-database` (`deploy` entities). Platform lists use `name`/`id`/`status` in six commands and `workspaceId`/`workspaceName`/`current` in `auth workspace list`.
4. **A field whose value has two kinds (1 command now, a pattern to forbid).** `orm init`'s `target` holds a short name for a listed database and a package name otherwise, so a reader cannot tell which it has. Its `package` field is one string although `init` installs many packages, reported separately in `packagesInstalled`. Nothing documented reads either.
5. **Diagnostics with two shapes (2 ORM commands).** The engine's diagnostic has `summary`, `nextActions` and `where: {path, line}`. `migration status` puts its own diagnostics inside `result` with `message` and `hints`. `migration check`'s failures have `where` as a string. These are findings that belong in the envelope's `diagnostics`.
6. **Absent values (all three repositories).** The engine leaves absent optional fields out. `migration status`, `deploy list` and the deploy report use `null`. The report promises `null` for every absent field but leaves out entity `url` and `details`. `db verify` documents that `unclaimed` is absent on a run that never looked. A rule is needed: absent, `null`, or empty, and when each.
7. **Top-level result shapes vary (6 Composer commands, and others).** `deploy` gives an object or `null`; `deploy list` a bare array; `dev` gives `null`; `migration ref list` gives refs as an object keyed by name while every other ORM list is an array. A bare array or `null` cannot gain a field later.
8. **One command, two documents (2 ORM commands).** `db verify --schema-only` and `db migrate --show` return a different document type from the same command. `migration graph --dot` adds a field.
9. **Schemas are almost never published (90 of 91 commands).** Only `orm init` publishes a schema. Six ORM schemas exist but are not exported. Composer exports TypeScript types from two packages (`@prisma/composer/control`, `@prisma/composer-cli/family`) and one result has none. Platform result types are unexported. The engine's envelope types are TypeScript only. The deploy report has TypeScript types and no schema or sample, which is how create-prisma missed the move to version 2.
10. **No format carries a version (every command).** Frames, envelopes, results, Markdown and data lines carry none. The deploy report is the only output with a `version`, and its error text field (`failure.message`) differs from the envelope's (`error.summary`), dropping `why`, `meta` and next actions.
11. **The written error shape does not match the wire (every command).** The Style Guide, prisma-cli `error-conventions.md`, `error-reference.md`, the `prisma-8` skill's `debug.md` and the `init-output` comment all describe a flat error `{ok: false, code, …}`, some with `fix`. The wire nests it as `envelope.error` inside a `result` frame, and has no `fix`. `@prisma/cli-engine/protocol` exports the flat `CliErrorEnvelope`, which the engine never writes. The errored envelope has no `exitCode` while the completed one does.
12. **"`--json` outputs a single JSON object" is no longer true (every command).** The Style Guide and the ORM README say one object. The engine writes newline-delimited frames ending in a result frame, and the set of frames depends on `--log-level`, so `--quiet` changes the JSON stream. The design must say whether frames are part of the promise or only the last line is.
13. **Exit codes are declared three ways (4 ORM commands, 0 elsewhere).** The Style Guide requires an exported exit-code module per command. Only `migration check` has one, and it is not on the package surface. `orm init`, `db verify` and `db sign` declare codes inline. No Composer or platform command uses the 4 to 99 band, so findings are only distinguishable by `diagnostics`. Two cases settle oddly: `deploy` exits 0 when it could not write the report it was asked for, and `migration status` exits 0 with `warn` findings. prisma-cli `error-conventions.md` says 1 is "runtime or command failure", contradicting the engine.
14. **Data-line escaping is not one rule (about 55 commands with data lines).** The engine writes lines as given. The ORM and Composer escape tab, newline, carriage return and backslash; the platform commands do not, so a tab inside a value corrupts the columns. Two ORM outputs (`contract print`, `migration graph --dot`) print documents unescaped by design. Composer's `dev` has neither data lines nor a `noDataLines` reason.
15. **The Markdown output has no rule (every command).** It is the human output in Markdown, so it changes whenever human wording or layout changes. The design must decide whether an agent may depend on anything in it (for example the `[error] CODE:` line, headings, table columns) or only on its existence. Two shell notices still go to stderr under Markdown.
16. **Help is not data (every command).** There is no machine-readable list of commands, flags and defaults, so a CI check of "flags did not change" has nothing to compare, and an agent cannot discover flags as data. `--help --json` prints nothing on stdout.
17. **Maturity is never stated (every command).** The engine has no field for a level, so the plan's "help states the level below GA" needs engine support first. Composer is at 0.x and the platform commands are new; whether all 91 go out as GA is undecided.
18. **Two error documentation sites (every command).** ORM errors link to `docs.prisma.io/docs/orm/v8/reference/error-reference#<CODE>`; Composer and platform errors to `www.prisma.io/docs/cli/error-reference/`. `docsUrl` is a field a reader may follow.
19. **Files and environment that programs may rely on (about 10 commands).** `.prisma/local.json`, `.prisma/skills.json`, `<config>/prisma/auth.json` and `<config>/prisma/config.json` have no documented format. The engine passes `PRISMA_SERVICE_TOKEN` and `PRISMA_WORKSPACE_ID` to child processes without a written promise. ORM ref and migration files are covered by project 2.
20. **Reserved names (7 paths).** Prisma 7 paths such as `version`, `mcp` and `debug` exit 2 as redirects. A later 8.x command at one of those paths changes an existing path's behaviour; the design should say whether that counts as compatible.
21. **Readers depend on shapes nobody promised (create-prisma, the `prisma-8` skill).** create-prisma accepts the old `command` field and `message` in diagnostics, tolerating formats the engine no longer writes, and its tests use hand-written documents. The skill teaches the flat error shape. Both should be tested against published schemas once they exist.
