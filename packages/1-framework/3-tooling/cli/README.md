# @internal/cli

> **For the CLI command, install [`@prisma/cli`](https://www.npmjs.com/package/@prisma/cli) (`@next` dist-tag).**
> The unified `prisma` binary mounts this package's `orm` command family;
> the standalone npm package is no longer published. Inside this
> workspace a local `prisma` bin still exists for examples and development — it
> is the same engine entry (`dist/bin.mjs`), just workspace-local.
>
> This package (`@internal/cli`) is both the CLI's implementation and the
> documented programmatic-API import target. Authors of build integrations,
> extension packs, and advanced config wiring import from
> `@internal/cli/config-types`, `@internal/cli/control-api`,
> `@internal/cli/commands/*`, and `@internal/config-loader`. These
> subpaths are less stable than the facade packages
> (`@internal/postgres/config`, `@internal/mongo/config`); prefer those
> for application-level config.
>
> This README is architecture and internal documentation for contributors.
> Command examples below use the workspace-local `prisma` bin; end users
> run the same commands through the published `@prisma/cli` binary.

Command-line interface for Prisma 8 contract emission and management.

## Overview

The CLI provides commands for emitting canonical `contract.json` and `contract.d.ts` files from TypeScript-authored contracts. It enforces import allowlists and validates contract purity to ensure deterministic, reproducible artifacts. Generated files include metadata and warning headers to indicate they're generated artifacts and should not be edited manually.

## Purpose

Provide a command-line interface that:
- Loads TypeScript-authored contracts using esbuild with import allowlisting
- Validates contract purity (JSON-serializable, no functions/getters)
- Invokes the emitter to produce canonical artifacts
- Handles all file I/O operations (CLI handles I/O; emitter returns strings)

## Responsibilities

- **TS Contract Loading**: Bundle and load TypeScript contract files with import allowlist enforcement
- **CLI Command Interface**: Contribute the `orm` command family to the `@prisma/cli-engine` shell; the engine parses arguments, prints help, and settles results
- **File I/O**: Read TS contracts, write emitted artifacts (`contract.json`, `contract.d.ts`)
- **Extension Pack Descriptor Assembly**: Collect adapter and extension descriptors for emission
- **Config Management**: Load and validate `prisma.config.ts` files using Arktype validation
- **Workspace-local bin**: Build emits `dist/bin.mjs`, the engine entry the workspace's local `prisma` bin points at (the published toolchain ships no bin; the unified `prisma` CLI mounts the family instead)

### Wiring validation

The CLI performs **wiring validation** at the composition boundary: it ensures the emitted contract artifacts are compatible with the descriptors wired in `prisma.config.ts`.

This prevents runtime mismatches (for example: a contract that declares extension packs, but a config that doesn’t provide the matching descriptors).

Commands that enforce wiring validation:
- **`db verify`**
- **`db sign`**
- **`db init`**
- **`db update`**

If you hit a wiring validation error: add the required descriptors to `config.extensions` (matched by descriptor `id`) and re-run the command.

**Note**: Control plane domain actions (database verification, contract emission) are implemented in `@internal/emitter` and `@internal/framework-components/control`. The CLI uses the control plane domain actions programmatically but does not define control plane types itself.

## Command Descriptions

Each engine command declares a `brief` (one-liner used in command trees and headers) and a `description` (multiline text shown in help output). Both live on the command definitions under `src/orm/`; the engine renders them.

## Commands

### `prisma orm init`

Sets a project up for Prisma ORM 8: writes `prisma.config.ts`, a starter schema (PSL or TypeScript), `src/prisma/db.ts`, `prisma-8.md`, and `.env.example`; merges `tsconfig.json`, `.gitignore`, `.gitattributes`, and `package.json`; installs the target package, the driver it declares as a peer dependency (`mongodb` for MongoDB), `dotenv`, and `prisma@latest`; then runs `prisma contract emit`. Interactively it asks for the target, the authoring style, and the schema path; `--target` and `--authoring` make it scriptable.

**Canonical command:**
```bash
prisma orm init [--target postgres|mongodb] [--authoring psl|typescript] [--schema-path <path>] [--from-prisma7-schema <path>] [--confirm <dir>] [--skip-install] [--write-env] [--probe-db] [--json]
```

**On a Prisma 7 project.** Init behaves like `git init`: it sets up what Prisma 8 needs to operate in the project and stops. It never connects to the database beyond the opt-in `--probe-db` version check, never writes to it, and never edits Prisma 7's schema or migrations. The Prisma 7 path is entered only through `--from-prisma7-schema <path>` or a yes to the question init asks when it finds a Prisma 7 config (`prisma.config.*` without the `$prismaConfig` marker) or a `.prisma` file with a `datasource` block where an earlier Prisma CLI looks for its schema (the path the `prisma.schema` field of `package.json` names, else `prisma/schema.prisma`, `schema.prisma` or the `prisma/schema` folder):

```
? prisma/schema.prisma is a Prisma 7 schema. Use it as the Prisma 8 contract source? (y/n)
? Prisma 7 is installed as `prisma`. Keep it as @prisma/prisma7 (binary prisma7) and move `prisma` to Prisma 8, and rename prisma.config.ts to prisma7.config.ts? Type <dir> to confirm.
```

A no, `--yes`, or a session that cannot ask runs init as today.

The target comes from the schema's `datasource` provider: `postgresql` or `mongodb`. `--target` may only agree with it, or name the database when the provider is not a string literal. With `--from-prisma7-schema`, a mismatch fails with `CLI.INIT_PRISMA7_TARGET_MISMATCH`, and a provider with no target with `CLI.INIT_PRISMA7_PROVIDER_UNSUPPORTED`, before anything is asked or installed. Without the flag, init does not ask its Prisma 7 question when the target cannot be resolved this way, and runs as a fresh init.

Before any consent question or file change, init checks that Prisma 8 can read the schema. It installs the target package and `dotenv`, loads the package's `/config` entrypoint from the project, and runs its `prisma7Schema` source in memory. The CLI carries no target code, so the installed package is the only one that can answer. Outcomes:

- The source reads the schema: init continues.
- The source refuses the schema, for example a `view` block: `CLI.INIT_PRISMA7_SCHEMA_REFUSED` with the source's diagnostics. The project is unchanged apart from the two packages, and the error gives the command that removes them.
- The package has no `prisma7Schema`: after a yes to the question, init warns before its next question and runs as a fresh init for that target; the warning says when that replaces the Prisma 7 `prisma.config.ts` (after asking) and the Prisma 7 CLI. With `--from-prisma7-schema` it stops with `CLI.INIT_PRISMA7_SOURCE_UNAVAILABLE`.
- `--skip-install` and the package is not installed: init warns that it could not check and continues.

The second question is the consent token; `--confirm <dir>` answers it non-interactively. Under it init:

- renames the Prisma 7 config to `prisma7.config.<same extension>` and points its `prisma/config` import at `@prisma/prisma7/config`; a config that does not import `prisma/config` is renamed with its imports unchanged, and init warns that any other import of the Prisma 7 config helper must be pointed at `@prisma/prisma7/config` by hand;
- rewrites every `package.json` script that invokes `prisma` to invoke `prisma7` (scripts init adds keep `prisma`);
- installs `@prisma/prisma7@7` as a development dependency alongside `prisma@latest`, and `@prisma/client@7` when the project declares a client below the 7 line.

It then writes `prisma.config.ts` with `contract: prisma7Schema("<schema path>")` and `output: "src/prisma"`, `src/prisma/db.ts`, and a `prisma-8.md` that describes the transition loop; no starter schema is written and `prisma/` stays byte-identical. The next steps are the transition routine: set `DATABASE_URL`, `prisma db sign`, move routes one at a time, and re-run `prisma contract emit` then `prisma db sign` after each `prisma7 migrate dev`.

**On a Prisma 6 MongoDB project.** A schema whose `datasource` says `provider = "mongodb"` is a Prisma 6 schema, since Prisma 7 has no MongoDB support. When init finds one where it looks for a Prisma 7 schema, or at the path `--from-prisma7-schema` names, it stops with `CLI.INIT_PRISMA6_SCHEMA_FOUND` before asking, installing, or writing anything, and never suggests the Prisma 7 path. Its next actions are the side-by-side setup the Mongo package documents: the Prisma 6 CLI moves to an npm alias with a `prisma6` script and its own `prisma6.config.ts` (both CLIs are published as `prisma`, and the Prisma 6 CLI reads `prisma.config.ts`), Prisma 8 is installed, and `prisma.config.ts` reads the schema through `prisma6Schema`. Init does not make these edits itself. With `--target` and `--authoring`, init sets up a starter in the same project and warns that this breaks the Prisma 6 CLI: the `prisma.config.ts` it writes makes every Prisma 6 command fail until Prisma 6 gets its own config file, and its install step replaces the Prisma 6 CLI with `prisma@latest`.

**Design constraints on the Prisma 7 path:**

- There is no separate upgrade command. Init already installs, scaffolds, and emits. A command that automated the whole upgrade guide could not find its inputs reliably in arbitrary projects (computed config values, multi-file schemas, monorepos, CI files that call `prisma migrate`), and the Prisma 7 contract source removes the need for a schema converter.
- From a Prisma 7 config init reads only `schema`. The new config connects with `process.env['DATABASE_URL']!`: copying the Prisma 7 `datasource.url` expression would need a TypeScript rewrite of user code, and matching its resolved value back to an environment variable assumes the URL came from one.
- Init's files go under `src/prisma/`, where a fresh init puts them, so an upgraded project is shaped like a new one. `prisma/` belongs to Prisma 7.
- The Prisma 7-specific edits (renaming the config, changing its import, rewriting scripts that call `prisma`, moving the Prisma 7 packages) all happen under one consent; the file merges a fresh init makes happen as usual. Renaming the config alone would leave scripts calling a `prisma` binary that is now Prisma 8, and `@prisma/client` moves with the Prisma 7 CLI because Prisma 7 requires both at the same version.
- `package.json#type` and `tsconfig.json` are handled as on a fresh init (an existing project that declares `dependencies` keeps its module type); see [TypeScript module settings for Prisma 8 projects](../../../../docs/reference/typescript-module-settings.md).
- There is no cutover step. The next steps list only what the user runs right after init.

**Exit codes:**
- `0`: set up (and, unless skipped, installed and emitted)
- `2`: precondition — an invalid flag, a refusal on the Prisma 7 path (`CLI.INIT_FLAG_CONFLICT`, `CLI.INIT_PRISMA7_SCHEMA_INVALID`, `CLI.INIT_PRISMA7_CONFIG_COLLISION`, `CLI.INIT_PRISMA7_CONFIG_UNREADABLE`, `CLI.INIT_PRISMA7_TARGET_MISMATCH`, `CLI.INIT_PRISMA7_PROVIDER_UNSUPPORTED`, `CLI.INIT_PRISMA7_SCHEMA_REFUSED`, `CLI.INIT_PRISMA7_SOURCE_UNAVAILABLE`), a consent not granted, or a write that failed; nothing is written before a refusal, and the schema check's install is the only change before one
- `3`: an interactive prompt was cancelled
- `4`: dependency install failed; on the Prisma 7 path this can be the install before the schema check, in which case nothing is written
- `5`: scaffold written and installed; contract emit failed

**`--json`:** the success document names every file written, deleted, or renamed, every package installed, and the next steps. On the Prisma 7 path `authoring` is `prisma7`, `schemaPath` is the Prisma 7 schema, and `prisma7` records the adoption; on a normal run `filesRenamed` is `[]` and `prisma7` is `null`.

```json
{
  "ok": true,
  "target": "postgres",
  "authoring": "prisma7",
  "schemaPath": "prisma/schema.prisma",
  "filesWritten": ["prisma.config.ts", "src/prisma/db.ts", "prisma-8.md", ".env.example", "tsconfig.json", ".gitignore", ".gitattributes", "package.json"],
  "filesDeleted": [],
  "filesRenamed": [{ "from": "prisma.config.ts", "to": "prisma7.config.ts" }],
  "packagesInstalled": { "status": "skipped", "deps": [], "devDeps": [] },
  "contractEmitted": false,
  "prisma7": {
    "schemaPath": "prisma/schema.prisma",
    "configRenamedTo": "prisma7.config.ts",
    "scriptsRewritten": ["generate", "migrate", "studio"],
    "packagesMoved": ["@prisma/prisma7@7"]
  },
  "nextSteps": ["1. Set DATABASE_URL in your environment (export it or add it to .env).", "…"],
  "warnings": []
}
```

### `prisma contract emit` (canonical)

Emit `contract.json` and `contract.d.ts` from `config.contract`.

**Canonical command:**
```bash
prisma contract emit [--config <path>] [--json] [-v] [-q] [--color/--no-color]
```

**Config File Requirements:**

The `contract emit` command does not require a `driver` in the config since it doesn't connect to a database:

```typescript
import { defineConfig } from '@internal/cli/config-types';
import { typescriptContract } from '@internal/sql-contract-ts/config-types';
import postgresAdapter from '@internal/adapter-postgres/control';
import postgres from '@internal/target-postgres/control';
import sql from '@internal/family-sql/control';
import { contract } from './prisma/contract';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  extensions: [],
  contract: typescriptContract(contract, 'src/prisma/contract.json'),
});
```

Options:
- `--config <path>`: Optional. Path to `prisma.config.ts` (defaults to `./prisma.config.ts` if present)
- `--json`: Output as JSON object
- `-q, --quiet`: Quiet mode (errors only)
- `-v, --verbose`: Verbose output (debug info, timings)
- `-vv, --trace`: Trace output (deep internals, stack traces)
- `--color/--no-color`: Force/disable color output

Examples:
```bash
# Use config defaults
prisma contract emit

# JSON output
prisma contract emit --json

# Verbose output
prisma contract emit -v
```

### `prisma db verify`

Verify that a database instance matches the emitted contract by checking the marker first and, by default, the live schema second.

**Command:**
```bash
prisma db verify [--db <url>] [--config <path>] [--marker-only | --schema-only] [--strict] [--json] [-v] [-q] [--color/--no-color]
```

Options:
- `--db <url>`: Database connection string (optional; defaults to `config.db.connection` if set)
- `--config <path>`: Optional. Path to `prisma.config.ts` (defaults to `./prisma.config.ts` if present)
- `--marker-only`: Skip schema verification and only check the database marker
- `--schema-only`: Skip marker verification and only check whether the live schema satisfies the contract
- `--strict`: When schema verification runs, schema elements not present in the contract are considered an error
- `--marker-only` cannot be combined with `--schema-only` or `--strict` (exit code 2, `PN-CLI-4012`). `--schema-only --strict` is valid.
- `--json`: Output as JSON object
- `-q, --quiet`: Quiet mode (errors only)
- `-v, --verbose`: Verbose output (debug info, timings)
- `-vv, --trace`: Trace output (deep internals, stack traces)
- `--color/--no-color`: Force/disable color output

Examples:
```bash
# Use config defaults
prisma db verify

# Specify database URL
prisma db verify --db postgresql://user:pass@localhost/db

# Marker-only verification when callers accept the trade-off
prisma db verify --db postgresql://user:pass@localhost/db --marker-only

# Schema-only verification without relying on marker state
prisma db verify --db postgresql://user:pass@localhost/db --schema-only

# Strict schema verification (extras fail)
prisma db verify --db postgresql://user:pass@localhost/db --strict

# JSON output
prisma db verify --json

# Verbose output
prisma db verify -v
```

**Config File Requirements:**

The `db verify` command requires a `driver` in the config to connect to the database:

```typescript
import { defineConfig } from '@internal/cli/config-types';
import { typescriptContract } from '@internal/sql-contract-ts/config-types';
import postgresAdapter from '@internal/adapter-postgres/control';
import postgresDriver from '@internal/driver-postgres/control';
import postgres from '@internal/target-postgres/control';
import sql from '@internal/family-sql/control';
import { contract } from './prisma/contract';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensions: [],
  contract: typescriptContract(contract, 'src/prisma/contract.json'),
  db: {
    connection: process.env.DATABASE_URL, // Optional: can also use --db flag
  },
});
```

**Verification Process:**

1. **Load Contract**: Reads the emitted `contract.json` from `config.contract.output`
2. **Connect to Database**: Uses `config.driver.create(url)` to create a driver
3. **Create Family Instance**: Creates a `ControlStack` via `createControlStack()` and passes it to `config.family.create(stack)` to create a family instance
4. **Verify Marker**: Calls `familyInstance.verify()` which:
   - Reads the contract marker from the database
   - Compares marker presence: Returns `PN-RUN-3001` if marker is missing
   - Compares target compatibility: Returns `PN-RUN-3003` if contract target doesn't match config target
   - Compares storage hash: Returns `PN-RUN-3002` if `storageHash` doesn't match
   - Compares profile hash: Returns `PN-RUN-3002` if `profileHash` doesn't match (when present)
   - Checks codec coverage (optional): Compares contract column types against supported codec types and reports missing codecs
5. **Verify Schema (default)**: Unless `--marker-only` is provided, calls `familyInstance.schemaVerify()` to catch schema mismatches such as missing tables or columns after manual DDL. By default this runs in tolerant mode; `--strict` treats schema elements not present in the contract as an error.
6. **Schema-only mode**: `--schema-only` skips marker verification entirely and runs only `schemaVerify()`. This is useful for brownfield adoption and corrupt-marker diagnosis.

**Output Format (TTY):**

Success:
```text
✔ Database marker and schema match contract
  verification: marker + schema
  storageHash: abc123...
  profileHash: def456...
```

Marker-only success:
```text
✔ Database marker matches contract
  verification: marker only (--marker-only)
  storageHash: abc123...
  profileHash: def456...

⚠ Schema verification skipped because --marker-only was provided
```

Marker failure:
```text
✖ Marker missing (PN-RUN-3001)
  Why: Contract marker not found in database
  Fix: Run `prisma db sign --db <url>` to create marker
```

Schema drift failure:
`db verify` prints the schema verification tree / JSON payload and exits with code 1.

**Output Format (JSON):**

```json
{
  "ok": true,
  "summary": "Database marker and schema match contract",
  "mode": "full",
  "contract": {
    "storageHash": "abc123...",
    "profileHash": "def456..."
  },
  "marker": {
    "storageHash": "abc123...",
    "profileHash": "def456..."
  },
  "target": {
    "expected": "postgres"
  },
  "missingCodecs": [],
  "schema": {
    "summary": "Database schema satisfies contract",
    "counts": {
      "pass": 12,
      "warn": 0,
      "fail": 0,
      "totalNodes": 12
    },
    "strict": false
  },
  "meta": {
    "configPath": "/path/to/prisma.config.ts",
    "contractPath": "/path/to/src/prisma/contract.json",
    "schemaVerification": "performed"
  },
  "timings": {
    "total": 42
  }
}
```

**Error Codes:**

- `PN-CLI-4010`: Missing driver in config — provide a driver descriptor
- `PN-RUN-3001`: Marker missing - Contract marker not found in database
- `PN-RUN-3002`: Hash mismatch - Contract hash does not match database marker
- `PN-RUN-3003`: Target mismatch - Contract target does not match config target
- Exit code 1 with schema verification payload: Schema does not match the contract (default mode or `--schema-only`)

**Family Requirements:**

The family must provide a `create()` method in the family descriptor that accepts a `ControlStack` and returns a `ControlFamilyInstance` with a `verify()` method:

```typescript
interface ControlFamilyDescriptor<TFamilyId, TFamilyInstance> {
  create<TTargetId extends string>(
    stack: ControlStack<TFamilyId, TTargetId>,
  ): TFamilyInstance;
}

interface ControlStack<TFamilyId, TTargetId> {
  readonly target: ControlTargetDescriptor<TFamilyId, TTargetId>;
  readonly adapter: ControlAdapterDescriptor<TFamilyId, TTargetId>;
  readonly driver: ControlDriverDescriptor<TFamilyId, TTargetId> | undefined;
  readonly extensions: readonly ControlExtensionDescriptor<TFamilyId, TTargetId>[];
}

interface ControlFamilyInstance {
  verify(options: {
    driver: ControlDriverInstance;
    contract: Contract;
    expectedTargetId: string;
    contractPath: string;
    configPath?: string;
  }): Promise<VerifyDatabaseResult>;
}
```

Use `createControlStack()` from `@internal/framework-components/control` to create the stack with sensible defaults (`driver` defaults to `undefined`, `extensions` defaults to `[]`).

The SQL family provides this via `@internal/family-sql/control`. The `verify()` method handles marker checks, full `db verify` follows it with `schemaVerify()`, `--marker-only` skips that schema step, and `--schema-only` runs `schemaVerify()` without marker checks.

### `prisma db schema`

Inspect the live database schema and display it as a human-readable tree or machine-consumable JSON. This command is read-only and never writes files.

On Postgres it leaves out `_prisma_migrations`, the table Prisma 7 records its applied migrations in.

**Command:**
```bash
prisma db schema [--db <url>] [--config <path>] [--json] [-v] [-q] [--color/--no-color]
```

Options:
- `--db <url>`: Database connection string (optional; defaults to `config.db.connection` if set)
- `--config <path>`: Optional. Path to `prisma.config.ts` (defaults to `./prisma.config.ts` if present)
- `--json`: Output as JSON object
- `-q, --quiet`: Quiet mode (errors only)
- `-v, --verbose`: Verbose output (debug info, timings)
- `-vv, --trace`: Trace output (deep internals, stack traces)
- `--color/--no-color`: Force/disable color output

Examples:
```bash
# Use config defaults
prisma db schema

# Specify database URL
prisma db schema --db postgresql://user:pass@localhost/db

# JSON output
prisma db schema --json

# Verbose output
prisma db schema -v
```

### `prisma contract print`

Load the contract from the source the config names and print the Prisma 8 PSL that reads back as the same contract, or write it to a file with `--output`. The source can be a Prisma 7 schema (`prisma7Schema(...)`), a TypeScript contract, or a PSL contract. The common use is cutover: a project on `prisma7Schema(...)` is ready to stop reading the Prisma 7 file and author in Prisma 8 PSL instead.

**Command:**
```bash
prisma contract print [--config <path>] [--output <path>] [--json] [-v] [-q] [--color/--no-color]
```

Options:
- `--config <path>`: Optional. Path to `prisma.config.ts` (defaults to `./prisma.config.ts` if present)
- `--output <path>`: Write the PSL to this file instead of printing it
- `--json`: Output a JSON result envelope (includes the PSL as `psl.text`, or `psl.path` with `--output`, the `source` files it read, and `sourceSettings`)
- `-q, --quiet`: Quiet mode (errors only)
- `-v, --verbose`: Verbose output (debug info, timings)
- `-vv, --trace`: Trace output (deep internals, stack traces)
- `--color/--no-color`: Force/disable color output

The command needs no database connection: it reads the source files, not the server. Without `--output`, it prints the PSL and writes no file. In a terminal the PSL is shown on screen. A pipe receives the JSON result, as with every command, unless you pass `--format human`, which sends the PSL alone to standard output:

```bash
prisma contract print --format human > printed.prisma
```

With `--output`, an existing file at that path is overwritten with a warning.

The printed PSL opens with two comment lines: the `// use prisma-8` marker, and a line naming the source files it was printed from:

```prisma
// use prisma-8
// Printed from prisma/schema.prisma by `prisma contract print`.
```

The printed PSL reads back as the identical contract. Where PSL has no form for part of the contract, the command refuses, names that part, and prints and writes nothing. It exits `2` in these cases:
- `CONTRACT.PRINT_UNSUPPORTED`: part of the contract cannot be written as PSL that reads back the same. The full list of cases is under that code in `docs/reference/error-reference.md`. A column type an extension contributes, such as pgvector's `Vector`, prints only when that extension is in the config.
- `CONTRACT.SOURCE_LOAD_FAILED`: the source cannot be read, reported exactly as `contract emit` reports it.
- The loaded contract fails the structure check `contract emit` applies, as a hand-written TypeScript contract can. The command runs the same check before it prints, so it reports the same error as `contract emit`.
- `CONTRACT.PRINT_OUTPUT_IS_SOURCE`: the `--output` path is a source file the config reads, sits inside a directory of source files, or names a new file that a glob input of the source would match once written. Pick another path.
- `CONTRACT.PRINT_OUTPUT_IS_PROJECT_FILE`: the `--output` path is the `prisma.config.ts` in the directory of the config that defines the `orm` section, or one of the files `contract emit` writes (`contract.json` and `contract.d.ts`, or whatever `contract.output` names). Pick another path.

These checks compare the files the paths name, not the text of the paths: a path through a symbolic link, or one that differs only in case on a volume that ignores case (the macOS default), counts as the same file.

A PSL file cannot carry the contract's default control policy. When the contract has one, the command prints a warning, names it in the JSON result (`sourceSettings.defaultControlPolicy`) and in the next step, and the config must set it on the new PSL source. Without it, the emitted contract has no default control policy, and everything that sets no control policy of its own is treated as managed. The facade `defineConfig` has no option for it, so build the PSL source with `prismaContract`, which comes from `@prisma/orm-family-sql` (add that package to the project's dependencies). For Postgres, with the PSL written to `prisma/contract.prisma`:

```typescript
// prisma.config.ts
import { definePrismaConfig } from 'prisma/config';
import { prismaContract } from '@prisma/orm-family-sql/contract-psl/provider';
import { defineConfig as ormConfig } from '@prisma/orm-postgres/config';
import { PG_INT_CODEC_ID, PG_TEXT_CODEC_ID } from '@prisma/orm-postgres/target/codec-ids';
import postgresPack from '@prisma/orm-postgres/target/pack';
import { postgresCreateNamespace } from '@prisma/orm-postgres/target/types';

export default definePrismaConfig({
  orm: ormConfig({
    contract: prismaContract('./prisma/contract.prisma', {
      target: postgresPack,
      createNamespace: postgresCreateNamespace,
      enumInferenceCodecs: { text: PG_TEXT_CODEC_ID, int: PG_INT_CODEC_ID },
      defaultControlPolicy: 'external',
    }),
    db: { connection: process.env['DATABASE_URL']! },
  }),
});
```

To switch to the written file, point `contract` in `prisma.config.ts` at it and run `prisma contract emit`. Without an explicit `output`, the facade names the emitted files after the contract path it is given, so switching `contract: './prisma/schema.prisma'` to `contract: './prisma/contract.prisma'` moves `schema.json` and `schema.d.ts` to `contract.json` and `contract.d.ts` and leaves the old files on disk; when the printed file would move them, the next step names both pairs of files. The next step writes every path relative to the directory of `prisma.config.ts`, because the config resolves its paths against that directory, not against the directory the command ran in. For a project leaving a Prisma 7 schema, the switch is the first step of the cutover; the rest takes migration ownership of the database Prisma 7 built:

```bash
prisma contract emit
prisma migration plan --name baseline
prisma db sign
prisma migration ref set db <timestamp>_baseline
```

### `prisma contract infer`

Inspect the live database schema and write an inferred PSL contract to disk. Use this for brownfield adoption when you want a starting `contract.prisma` before running `contract emit` and `db sign`.

On Postgres it writes no model for `_prisma_migrations`, the table Prisma 7 records its applied migrations in.

**Command:**
```bash
prisma contract infer [--db <url>] [--config <path>] [--output <path>] [--json] [-v] [-q] [--color/--no-color]
```

Options:
- `--db <url>`: Database connection string (optional; defaults to `config.db.connection` if set)
- `--config <path>`: Optional. Path to `prisma.config.ts` (defaults to `./prisma.config.ts` if present)
- `--output <path>`: Write the inferred PSL contract to the specified path
- `--json`: Output a JSON result envelope (includes `psl.path`)
- `-q, --quiet`: Quiet mode (errors only)
- `-v, --verbose`: Verbose output (debug info, timings)
- `-vv, --trace`: Trace output (deep internals, stack traces)
- `--color/--no-color`: Force/disable color output

Examples:
```bash
# Infer contract.prisma next to the configured contract.json output
prisma contract infer

# Specify database URL
prisma contract infer --db postgresql://user:pass@localhost/db

# Override the output path
prisma contract infer --output ./prisma/contract.prisma

# JSON output
prisma contract infer --json
```

By default, `contract infer` writes to:
1. `--output <path>`, if provided
2. `contract.prisma` next to `config.contract.output`
3. `contract.prisma` in the current working directory

**Config File Requirements:**

Both `db schema` and `contract infer` require a `driver` in the config to connect to the database:

```typescript
import { defineConfig } from '@internal/cli/config-types';
import { typescriptContract } from '@internal/sql-contract-ts/config-types';
import postgresAdapter from '@internal/adapter-postgres/control';
import postgresDriver from '@internal/driver-postgres/control';
import postgres from '@internal/target-postgres/control';
import sql from '@internal/family-sql/control';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensions: [],
  db: {
    connection: process.env.DATABASE_URL, // Optional: can also use --db flag
  },
});
```

**Introspection Process:**

1. **Connect to Database**: Uses `config.driver.create(url)` to create a driver
2. **Create Family Instance**: Creates a `ControlStack` via `createControlStack()` and passes it to `config.family.create(stack)` to create a family instance
3. **Introspect**: Calls `familyInstance.introspect()` which:
   - Queries the database catalog to discover schema structure
   - Returns a family-specific schema IR (e.g., `SqlSchemaIR` for SQL family)
4. **Transform to Schema View**: Calls `familyInstance.toSchemaView()` to project the schema IR into a `CoreSchemaView` for display
5. **Format Output**: Formats the schema view as a human-readable tree or JSON envelope

**Output Format (TTY):**

Human-readable schema tree:
```
sql schema (tables: 2)
├─ table user
│  ├─ id: int4 (not null)
│  ├─ email: text (not null)
│  └─ unique user_email_key
├─ table post
│  ├─ id: int4 (not null)
│  ├─ title: text (not null)
│  └─ userId: int4 (not null)
├─ extension plpgsql
└─ extension vector
```

**Output Format (JSON):**

```json
{
  "ok": true,
  "summary": "Schema introspected successfully",
  "schema": {
    "root": {
      "kind": "root",
      "id": "sql-schema",
      "label": "sql schema (tables: 2)",
      "children": [
        {
          "kind": "entity",
          "id": "table-user",
          "label": "table user",
          "children": [
            {
              "kind": "field",
              "id": "column-user-id",
              "label": "id: int4 (not null)",
              "meta": {
                "nativeType": "int4",
                "nullable": false
              }
            }
          ]
        }
      ]
    }
  },
  "meta": {
    "configPath": "/path/to/prisma.config.ts",
    "dbUrl": "postgresql://user:pass@localhost/db"
  },
  "timings": {
    "total": 42
  }
}
```

**Error Codes:**
- `PN-CLI-4010`: Missing driver in config — provide a driver descriptor
- `PN-CLI-4005`: Missing database connection — provide `--db <url>` or set `db.connection` in config

**Family Requirements:**

The family must provide:
1. A `create()` method in the family descriptor that returns a `ControlFamilyInstance` with an `introspect()` method
2. An optional `toSchemaView()` method on the `ControlFamilyInstance` to project family-specific schema IR into `CoreSchemaView`

```typescript
interface ControlFamilyInstance {
  introspect(options: {
    driver: ControlDriverInstance;
    contract?: Contract;
    schema?: string;
  }): Promise<FamilySchemaIR>;

  toSchemaView?(schema: FamilySchemaIR): CoreSchemaView;
}
```

The SQL family provides this via `@internal/family-sql/control`. The `introspect()` method queries the database catalog and returns `SqlSchemaIR`, and `toSchemaView()` projects it into a `CoreSchemaView` for display.

**Note:** The introspection output displays native database types (e.g., `int4`, `text`, `timestamptz`) rather than mapped codec IDs (e.g., `pg/int4@1`). This reflects the actual database state, which may be enriched with type mappings later.

### `prisma db sign`

Verify that the database satisfies the contract of every contract space (the application's and each extension's that ships one), then write or update the signature (contract marker) of each space that does. A signature records that this database is aligned with a specific contract version; `migrate` and the runtime compare it with the contract they are given.

**Command:**
```bash
prisma db sign [<contract> | --contract <contract>] [--db <url>] [--advance-ref <name> | --no-advance-ref] [--config <path>] [--json] [-v] [-q] [--color/--no-color]
```

Options:
- `<contract>` / `--contract <contract>`: Optional. The application contract to sign with: a hash, hash prefix, ref name, migration directory name, or `<dir>^`. Defaults to the emitted `contract.json`
- `--db <url>`: Database connection string (optional; defaults to `config.db.connection` if set)
- `--advance-ref <name>`: Advance the named ref of every signed space instead of `db`
- `--no-advance-ref`: Sign without writing any ref or snapshot
- `--config <path>`: Optional. Path to `prisma.config.ts` (defaults to `./prisma.config.ts` if present)
- `--json`: Output as JSON object
- `-q, --quiet`: Quiet mode (errors only)
- `-v, --verbose`: Verbose output (debug info, timings)
- `-vv, --trace`: Trace output (deep internals, stack traces)
- `--color/--no-color`: Force/disable color output

Examples:
```bash
prisma db sign
prisma db sign --db $DATABASE_URL
prisma db sign production --db $DATABASE_URL
prisma db sign --db $DATABASE_URL --advance-ref production
prisma db sign --db $DATABASE_URL --no-advance-ref
```

The command needs a `driver` in the config, as `db verify` does.

**Signing Process:**

1. **Load the contract spaces**: the application contract (emitted, or the one the contract reference names) and the contract space of every extension in `config.extensions`, as `migrate` loads them.
2. **Read the markers**: the marker of every space is read before the schema is.
3. **Verify each space**: each space's contract is checked against the live schema without strict mode.
4. **Sign**: the family's `signSpaces` writes the marker of every space that verified, but only while the marker still holds what step 2 read. On PostgreSQL and SQLite it first takes the lock `migrate` takes (one transaction-scoped advisory lock for the marker table on PostgreSQL, `BEGIN IMMEDIATE` on SQLite), and all markers are written in one transaction, so a failed write leaves every marker as it was. A marker that already holds the contract's hashes is left unchanged.
5. **Advance refs**: each signed or unchanged space's `db` ref (or the `--advance-ref` name) is advanced to its contract hash, and the contract is written into that space's snapshot store. `--no-advance-ref` skips this step. A ref or snapshot that cannot be written does not undo the markers: the command still writes every other ref, then fails with `MIGRATION.SIGN_REFS_NOT_WRITTEN`, which says the database was signed, names each ref it could not write and why, and gives the `db sign` command to run again once the cause is fixed.

A space that fails verification is not signed. Its differences are reported, the other spaces are still signed, and the command exits with code 4. A space whose marker another process, such as `migrate`, changed after step 2 is not signed either: its marker is left as that process wrote it, the other spaces are still signed, and the command exits with code 4. Running `db sign` again once the other process has finished signs it.

**Output Format (TTY):**

```
contract  output/contract.json
database  postgresql://localhost/app
✔ app: signed 6b4636f8… (was 93be6c20…)
✔ pgvector: unchanged, already signed with 0b8e2c5a…
✔ Database signed
✔ Advanced ref "db" → 6b4636f8… (was 93be6c20…)
✔ Advanced ref "db" of space "pgvector" → 0b8e2c5a…
```

**Output Format (JSON):**

```json
{
  "ok": true,
  "summary": "Database signed",
  "spaces": [
    {
      "space": "app",
      "status": "updated",
      "contract": { "storageHash": "6b4636f8…", "profileHash": "c1d2…" },
      "previous": { "storageHash": "93be6c20…", "profileHash": "c1d2…" }
    },
    {
      "space": "pgvector",
      "status": "unchanged",
      "contract": { "storageHash": "0b8e2c5a…", "profileHash": "c1d2…" }
    }
  ],
  "advancedRefs": [
    { "space": "app", "name": "db", "hash": "6b4636f8…" },
    { "space": "pgvector", "name": "db", "hash": "0b8e2c5a…" }
  ]
}
```

Each space has `space`, `status` and `contract`. `status` is `created` (the space had no marker), `updated` (with `previous`, the hashes the marker held), `unchanged` (the marker already held the contract's hashes), `failed` or `conflict`. A failed space also carries `schema`, the schema verification result; `ok` is then `false` and `summary` names the failed and the signed spaces, for example `Database schema does not satisfy contract for space "app"; signed "pgvector"`. Each failed space also produces one `CONTRACT.SCHEMA_VERIFICATION_FAILED` diagnostic with `space` in its meta. A space in conflict carries `expected` and `found`, the marker hashes `db sign` read and the ones it found when it came to write; `summary` then says, for example, `Marker of space "app" changed while db sign ran; signed "pgvector"`, and the space produces one `MIGRATION.MARKER_CAS_FAILURE` diagnostic with `space`, `expectedStorageHash`, `foundStorageHash` and `destinationStorageHash` in its meta.

**Exit codes:**
- `0`: every space signed or already signed
- `2`: the command could not run (unresolvable contract reference, no emitted contract, unreachable database, missing driver or connection), or it signed the database but could not write every ref (`MIGRATION.SIGN_REFS_NOT_WRITTEN`)
- `4`: schema verification failed for at least one space, or its marker changed while `db sign` ran; that space's signature was not written

**Relationship to Other Commands:**
- **`db verify`**: checks that the marker exists and matches the contract, then runs schema verification by default. `db sign` writes the marker that `db verify` checks.
- **`migrate`**: refuses with `MIGRATION.MARKER_MISMATCH` when the marker names a hash the migration history does not contain, for example after an upgrade that changed every contract's storage hash. `db sign` brings the marker back in step when the database already satisfies the contract.

**Idempotency:**
Running `db sign` again changes nothing: every marker already holds its contract's hashes and each ref already points at it. It is safe to run in CI and deployment pipelines.

**Family Requirements:**
The family instance implements `schemaVerify()` and `signSpaces()`:

```typescript
interface ControlFamilyInstance {
  schemaVerify(options: {
    driver: ControlDriverInstance;
    contract: Contract;
    strict: boolean;
    contractPath: string;
    configPath?: string;
  }): Promise<VerifyDatabaseSchemaResult>;

  signSpaces(options: {
    driver: ControlDriverInstance;
    spaces: readonly {
      space: string;
      contract: Contract;
      expected: { storageHash: string; profileHash: string } | null;
    }[];
  }): Promise<readonly SpaceSignature[]>;
}
```

`signSpaces` writes the marker of each space it is given with its contract's hashes, if the marker still holds `expected`, and returns one `SpaceSignature` per space: `{ status, space, contract }`, where `status` is `created`, `updated` (with `previous`, the hashes the marker held) or `unchanged`, or `{ status: 'conflict', space, contract, expected, found }` for a space whose marker no longer holds `expected` when it is read or when it is written. It does not verify; the command verifies every space first, and gives the spaces in the order `migrate` applies them, extension spaces first. The SQL family implements it through `SqlControlAdapter.withTransaction` and `SqlControlAdapter.lockMarker`, which takes the one lock the migration runner holds while it reads and writes markers, whatever the space. The Mongo family writes each marker on its own.

### `prisma db init`

Initialize a database schema from the contract. This command plans and applies **additive-only** operations (create missing tables/columns/constraints/indexes) until the database satisfies the contract, then writes the contract marker.

**Command:**
```bash
prisma db init [--db <url>] [--config <path>] [--dry-run] [--json] [-v] [-q] [--color/--no-color]
```

Options:
- `--db <url>`: Database connection string (optional; defaults to `config.db.connection` if set)
- `--config <path>`: Optional. Path to `prisma.config.ts` (defaults to `./prisma.config.ts` if present)
- `--dry-run`: Only show the migration plan, do not apply it
- `--json [format]`: Output as JSON (`object` only; `ndjson` is not supported for this command)
- `-q, --quiet`: Quiet mode (errors only)
- `-v, --verbose`: Verbose output (debug info, timings)
- `-vv, --trace`: Trace output (deep internals, stack traces)
- `--color/--no-color`: Force/disable color output

Examples:
```bash
# Initialize database with config defaults
prisma db init

# Preview migration plan without applying
prisma db init --dry-run

# Specify database URL
prisma db init --db postgresql://user:pass@localhost/db

# JSON output
prisma db init --json
```

**Config File Requirements:**

The `db init` command requires a `driver` in the config to connect to the database:

```typescript
import { defineConfig } from '@internal/cli/config-types';
import { typescriptContract } from '@internal/sql-contract-ts/config-types';
import postgresAdapter from '@internal/adapter-postgres/control';
import postgresDriver from '@internal/driver-postgres/control';
import postgres from '@internal/target-postgres/control';
import sql from '@internal/family-sql/control';
import { contract } from './prisma/contract';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensions: [],
  contract: typescriptContract(contract, 'src/prisma/contract.json'),
  db: {
    connection: process.env.DATABASE_URL, // Optional: can also use --db flag
  },
});
```

**Initialization Process:**

1. **Load Contract**: Reads the emitted `contract.json` from `config.contract.output`
2. **Connect to Database**: Uses `config.driver.create(url)` to create a driver
3. **Create Family Instance**: Creates a `ControlStack` via `createControlStack()` and passes it to `config.family.create(stack)` to create a family instance
4. **Introspect Schema**: Calls `familyInstance.introspect()` to get the current database schema IR
5. **Validate wiring**: Ensures the contract is compatible with the CLI config:
   - `contract.targetFamily` matches `config.family.familyId`
   - `contract.target` matches `config.target.targetId`
   - `contract.extensions` (if present) are provided by `config.extensions` (matched by descriptor `id`)
6. **Create Planner/Runner**: Uses `config.target.migrations.createPlanner()` and `config.target.migrations.createRunner()`
7. **Plan Migration**: Calls `planner.plan()` with the contract, schema IR, additive-only policy, and `frameworkComponents` (the active target/adapter/extension descriptors)
   - On conflict: Returns a structured failure with conflict list
   - On success: Returns a migration plan with operations
8. **Apply Migration** (if not `--dry-run`):
   - Calls `runner.execute()` to apply the plan
   - After execution, verifies schema matches contract
   - Writes contract marker (and records a ledger entry via the target runner)

**Output Format (TTY - Plan Mode):**

```
prisma db init ➜ Bootstrap a database to match the current contract
  config:          prisma.config.ts
  contract:        src/prisma/contract.json
  mode:            plan (dry run)

✔ Planned 4 operation(s)
│
├─ Create table user [additive]
├─ Add unique constraint user_email_key on user [additive]
├─ Create index user_email_idx on user [additive]
└─ Add foreign key post_userId_fkey on post [additive]

Destination hash: abc123...

This is a dry run. No changes were applied.
Run without --dry-run to apply changes.
```

**Output Format (TTY - Apply Mode):**

```
prisma db init ➜ Bootstrap a database to match the current contract
  config:          prisma.config.ts
  contract:        src/prisma/contract.json

Applying migration plan and verifying schema...
  → Create table user...
  → Add unique constraint user_email_key on user...
  → Create index user_email_idx on user...
  → Add foreign key post_userId_fkey on post...
✔ Applied 4 operation(s)
  Marker written: abc123...
```

**Output Format (JSON):**

```json
{
  "ok": true,
  "mode": "apply",
  "plan": {
    "targetId": "postgres",
    "destination": {
      "storageHash": "abc123..."
    },
    "operations": [
      {
        "id": "table.user",
        "label": "Create table user",
        "operationClass": "additive"
      }
    ]
  },
  "execution": {
    "operationsPlanned": 4,
    "operationsExecuted": 4
  },
  "marker": {
    "storageHash": "abc123..."
  }
}
```

**Error Codes:**
- `PN-CLI-4004`: Contract file not found
- `PN-CLI-4005`: Missing database URL
- `PN-CLI-4008`: Unsupported JSON format (`--json ndjson` is rejected for `db init`)
- `PN-CLI-4010`: Missing driver in config
- `PN-CLI-4020`: Migration planning failed (conflicts)
- `PN-CLI-4021`: Target does not support migrations
- `PN-RUN-3000`: Runtime error (includes marker mismatch failures)

**Behavior Notes:**

- If the database already has a marker that matches the destination contract, `db init` succeeds as a noop (0 operations planned/executed).
- If the database has a marker that does **not** match the destination contract, `db init` fails (including in `--dry-run` mode). Use `db init` for bootstrapping; use your migration workflow to reconcile existing databases.

### `prisma db update`

Update your database schema to match the currently emitted contract.

`db update` differs from `db init`:

- Works on any database, whether or not it has been initialized with `db init` (creates the signature table if missing)
- Allows `additive`, `widening`, and `destructive` operation classes where supported by planner/runner
- Disables per-operation runner execution checks by default (precheck/postcheck/idempotency)
- In `--dry-run` mode for SQL targets, prints a DDL preview derived from planned operations
- Before an apply, asks what each operation that would lose data means and whether each that would widen access may run (see **Questions before an apply** below)

**Command:**
```bash
prisma db update [--db <url>] [--to <contract>] [--advance-ref <name>] [--config <path>] [--dry-run] [--rename <old:new>]... [--delete <subject>]... [--allow <subject>]... [--interactive|--no-interactive] [--json] [-v] [-q] [--color/--no-color]
```

**Rename statements (`--rename <old>:<new>`, repeatable):** tell `db update` that a model or field was renamed, so it renames the table or column instead of dropping and creating it. The statements work exactly as they do for `migration plan` (see below), and produce the same operations. The origin contract they resolve against is the contract the database's marker names, read from the local snapshot store (`migrations/snapshots/<hash>/`). The snapshot is read on every run, so the planner sees the prior contract whenever one is stored; a missing or unreadable snapshot fails only a run with `--rename`. Either way the plan applies from whatever state the database is in, as `db update` always has. `db update` keeps a snapshot of the contract it applies whenever it advances a ref: the `db` ref by default, or with `--db <url>` only the ref you name with `--advance-ref <name>`. So to use renames against a database you update with `--db <url>`, give that earlier run `--advance-ref <name>`. Without a readable snapshot, a run with statements fails with `MIGRATION.STATEMENT_ORIGIN_UNKNOWN`, naming the hash and the directory it looked in, and gives the steps that store the missing snapshot: emit the contract the database is at, run `db update --advance-ref <name> --dry-run` against it and check that it plans no operations, then run it without `--dry-run`, which changes nothing in the database and stores the snapshot, then emit the new contract and run the rename. A database with no marker has nothing to rename, and fails the same way. Running the same statements a second time fails with `MIGRATION.STATEMENT_UNRESOLVED`, because the database is now at a contract that no longer has the old names. The statements the plan applied are listed under `Statements applied` after the operations (dry run and apply), and as `appliedStatements` in `--json` output, each with its `description` and `operationIndexes`, the positions in `operations` of the operations it accounts for.

**Questions before an apply:** an apply asks one question per model, field or storage name whose data an operation would lose (dropping a table or a column, or a type change that can change values), and one per model whose rows an operation would let more people read or write (disabling row-level security, for example). It asks before it applies anything. Subjects are named through the origin contract read from the snapshot store, as `migration plan` names them; without a readable snapshot each subject is its storage name, which can only be deleted or allowed, and the question says the origin contract is unknown. Recorded migrations of extension spaces are asked about for the data they would lose, never for widened access. Each question is answered with a statement:

- `--delete <subject>` lets the update lose that data, for example `--delete Legacy` or `--delete User.nickname`. A field of a model the update renames is named through the model's new name.
- `--rename <subject>:<new name>` keeps the data of a model or field under a new name instead. A field's new name keeps its model: `--rename User.nickname:User.handle`, which the question writes as `User.nickname:User.<new name>`.
- `--allow <subject>` lets the update change who can read or write that model's rows, for example `--allow User`. Each such operation is its own question: dropping a policy and disabling row-level security on one model take two `--allow User` flags. The question says disabling row-level security widens access, and that dropping a policy changes it, since a permissive policy grants access.

Where nobody can answer (the run is not interactive, or `--yes` is set), the command fails with `CLI.CONSENT_REQUIRED` and lists every unanswered question with the flags that answer it. In a terminal it asks each question in turn; a typed rename is planned again, and when the plan still loses the subject's data the command fails with `MIGRATION.STATEMENT_DID_NOT_RESOLVE_LOSS`. A `--delete` or `--allow` that answers no question fails with `CLI.CONSENT_UNUSED` before anything is applied. `--confirm` no longer consents to anything here. A dry run asks nothing: it lists the questions an apply would ask under `An apply asks about`, each with the flag that answers it, and as `dataLoss` and `accessWidening` in `--json` output, each entry's `text` being the subject as `--delete` or `--allow` takes it. A dry run checks its `--delete` and `--allow` values against those subjects and refuses one that matches none with `MIGRATION.STATEMENT_ANSWERS_NO_QUESTION`, so the exact command an apply will run can be previewed first. A question the dry run's flags answer is marked `(answered)` (`answered: true` in JSON), and the apply it suggests repeats the statement flags it was given, `--to` and `--advance-ref`, and `--db <url>` as a placeholder when the dry run named its database (the URL is never printed). The answers are listed under `Statements applied` after the renames, for example `delete field "User.nickname" (1 operation)`, and as `appliedStatements` entries with `verb` `delete` or `allow`. Programmatic callers of `dbUpdate` pass `answerQuestions`, which answers every question in order or throws to refuse. It is called at least once per apply, with an empty list when nothing is in question, even under `acceptDataLoss: true`; return `[]` then. `delete` and `allow` statements in `statements` answer their questions without asking (an `allow` answers one operation, so two operations on one model take two `allow` statements, as on the command line), and one that answers no question fails with `MIGRATION.STATEMENT_ANSWERS_NO_QUESTION`, in plan mode as in apply mode, before anything is applied. `acceptDataLoss: true` answers every data-loss question, and `acceptAccessWidening: true` every access-widening question.

**Error codes (additional to shared CLI/runtime codes):**
- `RUNNER_FAILED`: runner rejected apply (origin mismatch, failed checks, policy failures, or execution errors)
- `CLI.CONSENT_REQUIRED`, `CLI.CONSENT_UNUSED`: a question nobody answered, or a `--delete` or `--allow` that answered no question
- `MIGRATION.STATEMENT_DID_NOT_RESOLVE_LOSS`: a rename typed at the prompt did not stop the loss it answered
- `MIGRATION.STATEMENT_INVALID`, `MIGRATION.STATEMENT_UNRESOLVED`, `MIGRATION.STATEMENT_ORIGIN_UNKNOWN`: a `--rename` statement is malformed, does not resolve in the contracts, or has no origin contract to resolve against

**Config File (`prisma.config.ts`):**

The CLI uses a config file to specify the target family, target, adapter, extensions, and contract.

**Config Discovery:**
- `--config <path>`: Explicit path (relative or absolute)
- Default: `./prisma.config.ts` in current working directory
- No upward search (stays in CWD)

**Note:** The CLI uses `c12` for config loading, but constrains it to the current working directory (no upward search) to match the style guide's discovery precedence.

```typescript
import { defineConfig } from '@internal/cli/config-types';
import { typescriptContract } from '@internal/sql-contract-ts/config-types';
import postgresAdapter from '@internal/adapter-postgres/control';
import postgres from '@internal/target-postgres/control';
import sql from '@internal/family-sql/control';
import { contract } from './prisma/contract';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  extensions: [],
  contract: typescriptContract(contract, 'src/prisma/contract.json'),
});
```

Prefer helper utilities for authoring mode selection:
- `typescriptContract(contract, outputPath?)` from `@internal/sql-contract-ts/config-types` for TS-authored contracts
- `prismaContract(schemaPath, { output?, target? })` from `@internal/sql-contract-psl/provider` for PSL-authored providers
- Provider failures are returned as structured diagnostics for CLI rendering

The `contract.output` field specifies the path to `contract.json`. This is the canonical location where other CLI commands can find the contract JSON artifact. Defaults to `'src/prisma/contract.json'` if not specified.

`contract.d.ts` is always colocated with `contract.json` and derived from `contract.output` (`contract.json` → `contract.d.ts`).

**Output:**
- `contract.json`: Includes `_generated` metadata field indicating it's a generated artifact (excluded from canonicalization/hashing)
- `contract.d.ts`: Includes warning header comments indicating it's a generated file

### `prisma migration plan`

Plan a migration from contract changes. Compares a starting contract against a destination contract and produces a new migration package with the required operations. No database connection is needed — fully offline.

```bash
prisma migration plan [--config <path>] [--name <slug>] [--from <contract>] [--to <contract>] [--rename <old:new>]... [--delete <subject>]... [--interactive|--no-interactive] [--json] [-v] [-q] [--color/--no-color]
```

**Options:**
- `--config <path>`: Path to `prisma.config.ts`
- `--name <slug>`: Name slug for the migration directory (default: `migration`)
- `--from <contract>`: Starting contract reference (hash, prefix, ref name, migration directory, `<dir>^`, or `@empty`). `@empty` names the empty-database origin deliberately. Defaults to the `db` ref; when the ref is absent, greenfield only on an empty graph — over existing migrations the command refuses (`MIGRATION.PLAN_ORIGIN_UNKNOWN`) unless `--from @empty` is passed.
- `--to <contract>`: Destination contract reference (hash, prefix, ref name, migration directory, or `<dir>^`). Defaults to the emitted `contract.json`. Use `--to <migration-dir>^` to plan a rollback toward a predecessor state.
- `--rename <old>:<new>`: Rename a model or a field instead of dropping and creating it. Repeat the flag for several statements; they apply in the order given. See **Rename statements** below.
- `--delete <subject>`: Let the plan lose the data of a model, a field, or a storage name the refusal lists. Repeat the flag for several. See **Data loss** below.
- `--json`: Output as JSON object
- `-q, --quiet`: Quiet mode (errors only)
- `-v, --verbose`: Verbose output (debug info, timings)

**What it does:**
1. Loads config and resolves the destination contract: `--to <contract>` if provided, otherwise `contract.json`
2. Reads existing migrations from `config.migrations.dir` (default: `migrations/`)
3. Determines the starting point: `--from <contract>` if provided, otherwise the `db` ref. When the ref is absent, greenfield only on an empty graph; over existing migrations the command refuses (`MIGRATION.PLAN_ORIGIN_UNKNOWN`) unless `--from @empty` is passed
4. Diffs the starting contract against the destination using the target's migration planner
5. Scaffolds a new migration package: `migration.ts` (containing `placeholder(...)` lambdas for any data transforms), `migration.json` (with a content-addressed `migrationHash` over the planned ops, or over `[]` when the planner could not lower any calls because of placeholders), and `ops.json` (the planned ops, or `[]` in the placeholder-blocked case). The bookend contracts are written write-if-absent into the shared snapshot store at `migrations/snapshots/<hex>/contract.{json,d.ts}`. The package is **always** fully attested — there is no draft state on disk.
6. If the plan has unfilled `placeholder(...)` slots, the command returns a successful `pendingPlaceholders` envelope (a warning, not a failure) asking the developer to fill in the slots before re-emitting. The output still lists the operations that resolved, and any `Statements applied`, so a rename and the drops beside it show; JSON `operations` lists the same operations, so the `operationIndexes` of `appliedStatements` point into it. The on-disk `ops.json` is `[]` and `migrationHash` is the hash of `(metadata, [])`, so applying the migration as-written will not advance the storage hash to the intended destination — the runner's destination-hash post-check surfaces this as a state mismatch. After filling in the placeholders, run `node migrations/<dir>/migration.ts` to re-emit `ops.json` and the corresponding `migrationHash`. `PN-MIG-2001` is raised only at self-emit time when a slot is still unfilled.

**Outputs:**
- `migrations/<dir>/migration.ts` — editable migration source (with `placeholder(...)` slots when the planner inserted them)
- `migrations/<dir>/migration.json` — fully attested metadata (`migrationHash: string`, never null)
- `migrations/<dir>/ops.json` — planned operations (empty list `[]` if placeholders blocked the planner)
- `migrations/snapshots/<hex>/contract.{json,d.ts}` — bookend contracts, written write-if-absent, keyed by each contract's storage hash (one entry for `from` when applicable, one for `to`)

**Rename statements:** each `--rename` names the old and the new name in contract vocabulary, never a table or a column. Each side is one of `Model`, `namespace.Model`, `Model.field` or `namespace.Model.field`; both sides name a model, or both name a field of the same model. Names match exactly, including case. A name without a namespace resolves when exactly one namespace declares the model. A field's model is named as the destination contract names it, so a model rename followed by a field rename on it is `--rename Profile:User --rename User.name:User.fullName`. The old name must exist in the starting contract and not in the destination; the new name must exist in the destination and not in the starting contract. Statements resolve before anything is written; a statement that is malformed fails with `MIGRATION.STATEMENT_INVALID`, and one that does not resolve fails with `MIGRATION.STATEMENT_UNRESOLVED`, naming what it searched and what it found. Each error's next step is the statement to type instead: the accepted forms, the statement written the right way round, the statements a model-and-field mix may have meant, or the order that works. A statement that has already been applied (the origin already has the new name and not the old one) says to leave it out. Statements cannot swap two names in one plan, and the error gives the three plans that do, through a temporary name. A plan from an empty database (`--from @empty`, or greenfield) has no models to rename, so every statement is unresolved. Moving a model to another namespace and renaming value objects are not supported in this release. On MongoDB the planner refuses every statement in this release: planning fails with `MIGRATION.PLANNING_FAILED`, carrying the statement, and nothing is planned. The planner renames the table or column, and the constraints and indexes named after it, ahead of the rest of the plan. On Postgres, a check, a row-level-security policy, or an expression or partial index whose SQL names a renamed column is dropped and created again, and adding a check back reads every row of the table under an exclusive lock, so on a large table such a rename takes time; `migration.ts` contains the same `...this.renameTable(...)` and `...this.renameColumn(...)` calls you could have written by hand. The statements are listed under `Statements applied` after the operations, each with its number of operations, and as `appliedStatements` in `--json` output, each with its `statement`, `description` and `operationIndexes`, the positions in `operations` of the operations it accounts for. A coordinate in a contract with no namespaces has no `namespaceId` in the JSON. A statement whose storage does not change, such as a model whose table name is kept with `@@map`, is listed with no operations. When the storage did not change at all and no statement needs an operation, no migration package is written and the output says so; when the storage changed but the planner planned nothing, planning fails with `MIGRATION.PLANNING_FAILED`, statements or not. A statement the planner cannot carry out, for example on a table whose control policy is not `managed`, fails planning with `MIGRATION.PLANNING_FAILED`, and the refused statement is carried in the error's conflicts.

**Data loss:** a plan that would lose data is written only once you say what each such operation means. The command asks one question per model, field or storage name whose data an operation would lose (dropping a table or a column, or a type change that can change values), before it writes anything, including the baseline package of an auto-baseline. Each question is answered with a statement:

- `--delete <subject>` lets the plan lose that data, for example `--delete Legacy` for a model or `--delete User.nickname` for a field. Data that no model of the starting contract stores is named by its storage name, as the question gives it, and can only be deleted. A field of a model the plan renames is named through the model's new name, as a field rename is written: after `--rename Profile:User`, a dropped `nickname` field is answered with `--delete User.nickname` or `--rename User.nickname:User.handle`.
- `--rename <subject>:<new name>` keeps the data of a model or field under a new name; a field's new name keeps its model (`--rename User.nickname:User.handle`). A rename on the command line is planned from the start, so the drop it replaces is never asked about. The question offers it only for a model or field the destination no longer has, so a field whose type changes is answered with `--delete`, and not on MongoDB, whose planner refuses renames in this release. There the question says how to keep the documents instead: rename the collection in `mongosh` on each database before a plan that drops it is applied; `db update` then drops nothing, and a migration written by `migration plan` still drops it.

Where nobody can answer (the run is not interactive, or `--yes` is set), the command fails with `CLI.CONSENT_REQUIRED` and lists every unanswered question with the flags that answer it. In a terminal it asks each question in turn: type `delete` to let the data go, or `rename <subject>:<new name>`; a rejected answer is asked again. A typed rename is planned again with the other renames, and when the plan still loses the subject's data the command fails with `MIGRATION.STATEMENT_DID_NOT_RESOLVE_LOSS`. A `--delete` that answers no question fails with `CLI.CONSENT_UNUSED` before anything is written. `--confirm` no longer consents to anything here. The deletes are listed under `Statements applied` after the renames, for example `delete model "Legacy" (1 operation)`, and in `--json` output each `appliedStatements` entry carries its `verb`, `rename` or `delete`; a delete's `statement` is `{ kind: 'delete', subject }`. The `⚠` marker stays on each destructive operation.

**Branching with `--from` and `--to`:** Use `--from` to create a migration edge from a specific contract hash instead of the default starting point. Use `--to` to plan toward any resolved contract — including a rollback via `<migration-dir>^` — instead of the emitted contract. This enables branched migration graphs and arbitrary-target (including reverse) edges without editing contract source.

### `prisma migration show`

Display a migration package's operations, DDL preview, and metadata. Accepts a directory path, a hash prefix (git-style matching against `migrationHash`), or defaults to the latest migration.

```bash
prisma migration show [target] [--config <path>] [--json] [-v] [-q] [--color/--no-color]
```

**Options:**
- `[target]`: Migration directory path or `migrationHash` prefix (defaults to latest)
- `--config <path>`: Path to `prisma.config.ts`
- `--json`: Output as JSON object
- `-q, --quiet`: Quiet mode (errors only)
- `-v, --verbose`: Verbose output

**What it does:**
1. If `target` is a path (contains `/` or `\`), reads that directory directly
2. If `target` is a hash prefix, scans all attested migrations and matches against `migrationHash`
3. If no target, defaults to the latest migration
4. Displays operations with operation class badges, destructive warnings, and DDL preview

**Destructive warnings:** When a migration contains destructive operations (e.g., `DROP TABLE`, `ALTER COLUMN TYPE`), the output includes a prominent `⚠` warning about potential data loss.

### `prisma migration status`

Shows which migrations are pending between the database marker and the target contract. It reads the database marker by default and needs a connection. `--from` names the origin instead and runs offline, unless `--from` or `--to` is `@db`, which reads the database.

```bash
prisma migration status [--db <url>] [--to <contract>] [--from <contract>] [--space <id>] [--legend] [--ascii] [--config <path>] [--json] [-v] [-q] [--color/--no-color]
```

**Options:**
- `--db <url>`: Database connection string
- `--to <contract>`: Target contract reference (hash, prefix, ref name, migration dir name, `<dir>^`, `@contract`, `@db`, or `@empty`). Defaults to the emitted contract.
- `--from <contract>`: Origin contract reference, with the same forms as `--to`. Defaults to the database marker. With `--from`, the path is computed without reading the database, unless `--from` or `--to` is `@db`.
- `--space <id>`: Narrow output to a single contract space
- `--legend`: Print a key for the tree glyphs and lane colors
- `--ascii`: Use ASCII glyphs
- `--config <path>`: Path to `prisma.config.ts`
- `--json`: Output as JSON object
- `-q, --quiet`: Quiet mode (errors only)
- `-v, --verbose`: Verbose output

`@db` in either `--to` or `--from` resolves to the database marker, so the command reads the database and needs a connection. `--from` and `--to` apply to the app space. Each extension space goes to its own head: from its own marker when the command reads the database for the origin (no `--from`, or `--from @db`), and from the empty contract when `--from` names a contract.

**What it does:**
1. Reads migration packages from disk and reconstructs each space's migration graph
2. Resolves the origin (the database marker, or `--from`) and the target (the emitted contract, or `--to`)
3. With a database connection, reads each space's marker and ledger to mark migrations applied or pending
4. Draws each space's graph with `@db`, `@contract` and ref labels, and summarises what is pending
5. Warns `MIGRATION.MARKER_NOT_IN_HISTORY` when a marker is not in its space's history (a graph node, or the head of a space with no migrations)

### `prisma db migrate`

Apply planned migrations to the database. Executes previously planned migrations (created by `migration plan`). Compares the database marker against the migration graph to determine which migrations are pending, then executes them sequentially. Each migration runs in its own transaction. Does not plan new migrations — run `migration plan` first.

```bash
prisma db migrate [--db <url>] [--to <contract>] [--advance-ref <name>] [--show] [--from <contract>] [--config <path>] [--json] [-v] [-q] [--color/--no-color]
```

**Options:**
- `--db <url>`: Database connection string (optional; defaults to `config.db.connection`)
- `--to <contract>`: Target contract reference (hash, prefix, ref name, migration directory, `<dir>^`, `@contract`, `@db`, or `@empty`). When omitted, applies toward the emitted `contract.json`; `--to @contract` does the same. When `--to` resolves to another on-disk graph node, verification and apply use the snapshot store entry for that node's hash — so a planned rollback or other arbitrary-target edge applies without editing contract source. A ref name is a `--to` form; refs live in `migrations/<space>/refs/<name>.json`.
- `--advance-ref <name>`: After a successful apply, advance the named ref to the new marker
- `--show`: Preview the migration route without applying anything (read-only)
- `--from <contract>`: The origin for the `--show` preview, with the same forms as `--to`. Defaults to the database marker. A contract other than `@db` makes the preview start offline; it still reads the database when `--to` is `@db`.
- `--config <path>`: Path to `prisma.config.ts`
- `--json`: Output as JSON object
- `-q, --quiet`: Quiet mode (errors only)
- `-v, --verbose`: Verbose output (debug info, timings)

**What it does:**
1. Reads migration packages from `config.migrations.dir`. Every package is attested — there is no on-disk draft state. The loader (`readMigrationPackage` in `@internal/migration-tools/io`) rehashes `(metadata, ops)` for each `MigrationPackage` it returns and confirms the result matches the stored `migrationHash`. If a package has been hand-edited or partially written since emit, the load fails with `MIGRATION.HASH_MISMATCH` pointing at the offending directory and asks the developer to re-run `node migrations/<dir>/migration.ts` (or restore from version control).
2. Reconstructs the migration graph from all loaded packages
3. Determines the destination hash and apply contract: from `--to`, or from `contract.json` when `--to` is omitted or `@contract`
4. Connects to the database and reads the current marker hash
5. Finds the shortest path from the marker hash to the destination using graph pathfinding
6. Executes each pending migration in order using the target's `MigrationRunner`
7. Each migration runs in its own transaction with prechecks, postchecks, and idempotency checks enabled
8. After each migration, the runner runs the migration's post-checks and verifies the resulting state matches the target contract's storage hash, then updates the marker/ledger

**Rollback workflow:** When no on-disk edge reaches the target (for example `db migrate --to <migration-dir>^`), the command refuses with `MIGRATION.PATH_UNREACHABLE` and suggests planning the missing edge with `migration plan --from <current> --to <target> --name <slug>`, then re-running `db migrate --to <target>`. No contract-source edit is required.

**Config requirements:** Requires `driver` and `db.connection` (or `--db`). `migrations.dir` is optional and defaults to `migrations/`.

**Resume semantics:** If a migration fails, previously applied migrations are preserved. Re-running `db migrate` resumes from the last successful migration.

### Emitting `ops.json` and computing `migrationHash`

There is no dedicated CLI command for emitting a migration — migrations
self-emit. After scaffolding (via `migration plan` or `migration new`),
run `migration.ts` directly with Node to produce `ops.json` and attest
`migration.json`:

```bash
node migrations/<dir>/migration.ts
```

The scaffolded `migration.ts` calls `MigrationCLI.run(import.meta.url, ...)` from `@internal/cli/migration-cli` when invoked as the entrypoint. (Postgres and SQLite scaffolds re-export `MigrationCLI` through `@internal/postgres/migration` or `@internal/sqlite/migration` so a `migration.ts` only needs the single facade import; Mongo scaffolds still pull from `@internal/cli/migration-cli` directly.) The CLI entrypoint loads `prisma.config.ts`, assembles a `ControlStack`, instantiates the migration with that stack (so `dataTransform` and other adapter-aware helpers can materialize a real adapter), and serializes operations to `ops.json` while writing the content-addressed `migrationHash` into `migration.json`. If `migration.ts` contains unfilled `placeholder()` slots, the script exits with `PN-MIG-2001` and reports the slot to fill in.

`MigrationCLI.run` accepts an optional third argument `{ argv?, stdout?, stderr? }` for in-process testability (default: `process.argv` / `process.stdout` / `process.stderr`) and returns the exit code as a `Promise<number>`. The flag surface is `--help` / `--dry-run` / `--config <path>`, parsed by [`clipanion`](https://github.com/arcanis/clipanion). The main multi-command surface (`contract emit`, `db verify`, etc.) runs on `@prisma/cli-engine`; the per-migration `MigrationCLI.run` entrypoint uses clipanion to keep authored migration files lightweight and in-process testable.

### `prisma migration ref`

Manage named refs, one file per ref at `migrations/<space>/refs/<name>.json`. Refs map logical environment names (e.g., `staging`, `production`) to contract hashes, enabling multi-environment migration workflows where different environments track different points in the migration graph.

```bash
prisma migration ref set <name> <contract>          # Set a ref to a contract (hash, ref, dir, ...)
prisma migration ref list                           # List all refs (use `migration ref list` and filter for one ref)
prisma migration ref delete <name>                  # Delete a ref
```

**Options (all subcommands):**
- `--config <path>`: Path to `prisma.config.ts`
- `--json`: Output as JSON object
- `-q, --quiet`: Quiet mode (errors only)

**Ref naming rules:** Lowercase alphanumeric with hyphens or forward slashes (e.g., `staging`, `prod/us-east`). No `.` or `..` segments.

**Ref values:** Must be valid contract hashes (64 lowercase hex chars, or the `empty` sentinel).

**Atomic writes:** each ref file is written atomically via temp file + rename to prevent corruption from concurrent writes.

## Architecture

```mermaid
flowchart TD
    CLI[CLI Entry Point]
    CMD_EMIT[Emit Command]
    CMD_DB[DB Commands]
    CMD_MIG[Migration Commands]
    EXEC_EMIT[executeContractEmit]
    PUBLISH[publishContractArtifactPair]
    EMIT[Emitter]
    CTRL[Control Client]
    MIG_TOOLS["@internal/migration-tools"]
    FS[File System]
    VITE["@internal/vite-plugin-contract-emit"]

    CLI --> CMD_EMIT
    CLI --> CMD_DB
    CLI --> CMD_MIG
    CMD_EMIT --> EXEC_EMIT
    VITE --> EXEC_EMIT
    EXEC_EMIT --> EMIT
    EXEC_EMIT --> PUBLISH
    PUBLISH --> FS
    CMD_DB --> CTRL
    CMD_MIG --> CTRL
    CMD_MIG --> MIG_TOOLS
    MIG_TOOLS --> FS
    CTRL --> FS
```

## Canonical Contract Emit Path

> **For agents/contributors**: `executeContractEmit` is the SINGLE publication path
> for `contract.json` + `contract.d.ts`. The CLI command (`prisma contract
> emit`) and the Vite plugin (`@internal/vite-plugin-contract-emit`) both
> call into it. Do NOT re-implement the load → emit → publish dance in a new
> caller; if you need additional behavior, extend `ContractEmitOptions` /
> `ContractEmitResult` and update `executeContractEmit` itself.

How it composes:

- The whole flow (load config → resolve source → emit bytes → publish) is
  serialized per output JSON path via `queueEmitByOutput`
  (`src/utils/emit-queue.ts`). Concurrent calls for the same output line up
  FIFO; concurrent calls for distinct outputs run in parallel. Last submission
  wins on disk.
- Within a single emit, `publishContractArtifactPair`
  (`src/utils/publish-contract-artifact-pair.ts`) stages temp files, renames
  `contract.d.ts` before `contract.json`, and attempts to restore the previous
  pair if either rename fails — so type-only consumers never observe a
  mismatched pair.
- Long-lived hosts (Vite dev server, watch CLIs) must call `disposeEmitQueue`
  on shutdown to drop the per-output queue state, otherwise the module-global
  queue map leaks one entry per unique output path.
- `loadContractSource(config, { signal, onWarning })` runs only the resolve-source step: it builds the control stack, runs `contract.source.load`, and returns the contract or the source's `{ summary, diagnostics }` without writing anything. `onWarning` receives each warning the source reports. `prisma orm init` uses it to check a Prisma 7 schema before it changes the project. `executeContractEmit`, `contract print` and `ControlClient.emit` load the source through the same step, so each reports a bad source with the same error.

The `validateContractDeps` warning is returned in `ContractEmitResult.validationWarning`
rather than written to stderr by the operation — callers (CLI, Vite plugin) decide
how to render it (`ui.warn`, plugin logger, etc.).

A contract source can report warnings while it still produces a contract, through the optional `reportWarning` on its `ContractSourceContext` (each a `ContractSourceDiagnostic` with `severity: 'warning'`). `executeContractEmit` collects them into `ContractEmitResult.sourceWarnings`, and `prisma contract emit` prints each as `warning <file>:<line>:<column> <code> <message>`; the language server shows them with warning severity.

## Config Validation and Normalization

The `defineConfig()` function validates and normalizes configs using Arktype:

- **Validation**: Validates config structure using Arktype schemas
- **Normalization**: Applies default values (e.g., `contract.output` defaults to `'src/prisma/contract.json'`)
- **Error Messages**: Provides clear, actionable error messages on validation failure

See `.cursor/rules/config-validation-and-normalization.mdc` for detailed patterns.

## Components

### CLI Entry Point (`src/orm/cli.ts` + `src/bin.ts`)
- `createOrmCli()` mounts the `orm` command family, groups, and command tree on `createCli()` from `@prisma/cli-engine`; the engine parses arguments, prints help, and settles result envelopes
- `src/bin.ts` is the thin process entry: it adapts the host process into the engine's `Runtime` (`runtimeFromProcess`) and exits with the settled code
- Exit codes, help output, `--json`, and shared flags (`--config`, `-q`, `-v`, `--color`) are engine policy, not implemented here
- The unified `prisma-cli` bin mounts the same family from `@prisma/orm-toolchain/cli`
- The CLI sets no global `Temporal` and has no dependency on a polyfill. The Postgres target's control entry sets a fallback `Temporal` for the target's own code when it is loaded, which happens when the CLI loads `prisma.config.ts`

### Contract Emit Command (`src/orm/contract/emit.ts`)
- Engine command definition; the handler returns a settled envelope and the engine renders it
- **Error Handling**: Structured errors (`CliStructuredError` from `@prisma/cli-engine/protocol`) carry `why`/`fix`/`nextActions`; the engine maps them to exit codes and output
- Loads the user's config module (`prisma.config.ts`)
- Resolves contract from provider:
  - Calls `config.contract.source.load(context)` — `context.resolvedInputs` carries the absolute paths the CLI loader resolved from `source.inputs` — and expects `Result<Contract, ContractSourceDiagnostics>`
  - Source-specific parsing/loading stays inside providers
  - Provider diagnostics are surfaced as actionable CLI failures
  - Throws error if `config.contract` is missing
- Uses artifact path from `config.contract.output` (already normalized by `defineConfig()` with defaults applied)
- Creates family instance via `config.family.create()` (assembles operation registry, type imports, extension IDs)
- Calls `familyInstance.emitContract()` with raw contract (instance handles stripping mappings and validation internally)
- Outputs human-readable or JSON format based on flags

### Programmatic API (`api/emit-contract.ts`)
- **`emitContract(options)`**: Programmatic API for emitting contracts
  - Accepts resolved contract, output paths, and assembly data
  - Caller is responsible for loading the contract and resolving paths
  - Returns result with hashes, file paths, and timings
  - Used by CLI command internally

### Error Handling (`utils/cli-errors.ts`, `src/orm/normalize-error.ts`)
- **Structured Errors**: Call sites raise `CliStructuredError` (from `@prisma/cli-engine/protocol`) with full context (why, fix, nextActions, docsUrl)
- **Settlement**: Handlers return settled envelopes; the engine renders them and maps them to exit codes (0 success, 1 runtime, 2 usage/config)
- **Normalization**: `normalizeError` adapts legacy library errors into the engine envelope shape
- **Fail Fast**: Non-structured errors propagate to the engine, which reports them as internal errors

### Pack Assembly
- **Family instances** now handle pack assembly internally. The CLI creates a family instance via `config.family.create()` and reads assembly data (operation registry, type imports, extension IDs) from the instance.
- **Removed**: `pack-assembly.ts` has been removed. Pack assembly is now handled by family instances. For SQL family, tests can import pack-based helpers directly from `packages/2-sql/3-tooling/family/src/core/assembly.ts` using relative paths.
- Assembly logic is family-specific and owned by each family's instance implementation (e.g., `createSqlFamilyInstance` in `@internal/family-sql`).

### Output Formatting (`utils/formatters/`)
- **Command Output Formatters**: Format human-readable output for commands (emit, verify, etc.)
  - Paths are shown as relative paths from current working directory (using `relative(process.cwd(), path)`)
  - Success indicators use consistent checkmark (✔) throughout
- **Error Output Formatters**: Format error output for human-readable and JSON display
- **Help and headers**: Help output, styled headers, and command trees are rendered by `@prisma/cli-engine`; the remaining formatters here build presentation models (migration graph/list/log geometry) that commands emit as data

### Family Descriptor (provided by family /cli entrypoint)
- The SQL family (and other families) provide:
  - `create(options)` - Creates a family instance that implements domain actions
  - `hook` - Target family hook for contract emission
- Family instances provide:
  - `deserializeContract(contractJson)` - Validates and normalizes contract, returns `Contract` without mappings
  - `emitContract(options)` - Emits contract (handles stripping mappings and validation internally)
  - `verify(options)` - Verifies database marker against contract
  - `schemaVerify(options)` - Verifies database schema against contract
  - `introspect(options)` - Introspects database schema

### Descriptor Declarative Fields
- Families expose component descriptors (target, adapter, driver, extensions) as plain TypeScript objects. Each descriptor includes **declarative fields**: metadata that describes what the component *provides* (independent of its runtime implementation), and that the CLI can safely copy into emitted artifacts.
  - Common declarative keys:
    - **`version`**: Component version included in emitted metadata (useful for debugging and reproducibility).
    - **`capabilities`**: Feature flags the component contributes (e.g., adapter/runtime lowering requirements). Typically namespaced by target (e.g., `{ postgres: { returning: true } }`) so contracts can be validated against the active target.
    - **`types`**: Type import specs and type IDs contributed by the component. Common examples:
      - `types.codecTypes.import`: Where to import codec type mappings for `contract.d.ts`.
      - `types.queryOperationTypes.import`: Where to import flat query-builder operation type signatures for `contract.d.ts` (adapters/extensions).
    - **`operations`**: Operation signatures the component contributes (extensions), used for type generation and (optionally) validation/lowering.
    - **Component-specific metadata**:
      - Extensions may also include control-plane-only metadata like `contractSpace` (used by verify, planning, and migration flows and not required at runtime).

Unlike the older **manifest-based IR** approach (separate JSON manifests + a parsing/validation step to build an IR), descriptors are imported directly from packages (e.g., `@internal/*/control`). This removes a file-format boundary and keeps the data and its types co-located.
- Benefits: fewer moving parts (no JSON parsing), easier refactors (TypeScript catches drift), and clearer ownership (the package exports the canonical descriptor object).
- Trade-offs: descriptors must be available as build-time imports (less dynamic discovery vs scanning arbitrary manifest files).

**Illustrative example (descriptor object):**

```typescript
import type { SqlControlExtensionDescriptor } from '@internal/family-sql/control';

const exampleExtension: SqlControlExtensionDescriptor<'postgres'> = {
  kind: 'extension',
  id: 'example',
  version: '1.0.0',
  familyId: 'sql',
  targetId: 'postgres',
  capabilities: { postgres: { 'example/feature': true } },
  types: {
    queryOperationTypes: {
      import: {
        package: '@internal/extension-example/operation-types',
        named: 'QueryOperationTypes',
        alias: 'ExampleQueryOperationTypes',
      },
    },
  },
  operations: [],
  create: () => ({ familyId: 'sql', targetId: 'postgres' }),
};

export default exampleExtension;
```

**How CLI consumers import/use it:**
- Config imports descriptors directly and passes them to `defineConfig()` (see “Config File Requirements” under `prisma contract emit` above; also see “Entrypoints” below for the `@internal/*/control` subpaths):

```typescript
import { defineConfig } from '@internal/cli/config-types';
import exampleExtension from '@internal/extension-example/control';

export default defineConfig({
  // family/target/adapter/driver omitted for brevity
  extensions: [exampleExtension],
});
```

## Design Decisions

1. **Import Allowlist**: Only `@internal/*` packages allowed (MVP). Expand later if needed.
2. **Utility Separation**: TS contract loading is a utility function, not a command. Commands use utilities.
3. **CLI Framework**: Commands are `@prisma/cli-engine` definitions; the engine owns parsing, help, and settlement. (The commander shell was deleted in the S5 cutover.)
4. **File I/O**: CLI handles all I/O; emitter returns strings (no file operations in emitter).
5. **Generated File Metadata**: Adds `_generated` metadata field to `contract.json` to indicate it's a generated artifact. This field is excluded from canonicalization/hashing to ensure determinism. The `contract.d.ts` file includes warning header comments generated by the emitter hook.

## Testing

The CLI package includes unit tests, integration tests, and e2e tests:

- **Unit tests**: Test individual functions and utilities in isolation
- **Integration tests**: Test component interactions (e.g., config loading, pack assembly)
- **E2E tests**: Test complete command execution with real config files

### E2E Test Patterns

E2E tests use a shared fixture app pattern to ensure proper module resolution:

- **Shared fixture app**: `test/cli-e2e-test-app/` contains a static `package.json` with dependencies
- **Fixture organization**: Fixtures are organized by command in subdirectories (e.g., `fixtures/emit/`, `fixtures/db-verify/`)
- **Ephemeral test directories**: Each test creates an isolated directory with files copied from fixtures
- **No package.json in test directories**: Test directories inherit workspace dependencies from the parent `package.json` at the root
- **Helper function**: `setupTestDirectoryFromFixtures()` handles directory setup and returns a cleanup function
- **Cleanup responsibility**: Each test must clean up its own directory (use `afterEach` hooks or `finally` blocks)

**Example:**
```typescript
import { setupTestDirectoryFromFixtures } from './utils/test-helpers';

const fixtureSubdir = 'emit';

it('test description', async () => {
  const testSetup = setupTestDirectoryFromFixtures(
    fixtureSubdir,
    'prisma.config.emit.ts',
  );
  const cleanupDir = testSetup.cleanup;

  try {
    // ... test code ...
  } finally {
    cleanupDir(); // Each test cleans up its own directory
  }
});
```

See `.cursor/rules/cli-e2e-test-patterns.mdc` for detailed patterns and examples.

Run tests:
```bash
pnpm test                    # Run all tests
pnpm test:unit              # Run unit tests only
pnpm test:integration       # Run integration tests only
pnpm test:e2e               # Run e2e tests only
```

## Programmatic Control API

The CLI package provides a programmatic control client for running control-plane operations without using the command line. This is useful for:

- Integration with build tools and CI pipelines
- Custom orchestration workflows
- Test automation
- Programmatic database management

### Basic Usage

```typescript
import { createControlClient } from '@internal/cli/control-api';
import sql from '@internal/family-sql/control';
import postgres from '@internal/target-postgres/control';
import postgresAdapter from '@internal/adapter-postgres/control';
import postgresDriver from '@internal/driver-postgres/control';

// Create a control client with framework component descriptors
const client = createControlClient({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensions: [],
});

try {
  // Connect to database
  await client.connect(databaseUrl);

  // Run operations
  const verifyResult = await client.verify({ contract });
  const initResult = await client.dbInit({ contract, mode: 'apply', migrationsDir: 'migrations' });
  const updateResult = await client.dbUpdate({
    contract,
    mode: 'apply',
    migrationsDir: 'migrations',
    // Asked before an apply about each operation that would lose data or widen access.
    // Answer each question in order, as `{ verb, text }`, or throw to refuse.
    answerQuestions: async (questions) => {
      if (questions.length > 0) throw new Error('db update would lose data or widen access');
      return [];
    },
  });
  const introspectResult = await client.introspect();
} finally {
  // Clean up
  await client.close();
}
```

### Available Operations

| Method | Description |
|--------|-------------|
| `connect(url)` | Establishes database connection |
| `close()` | Closes connection (idempotent) |
| `readMarker()` | Reads contract marker from database (null if none) |
| `verify(options)` | Verifies database marker matches contract |
| `schemaVerify(options)` | Verifies database schema satisfies contract |
| `dbSign(options)` | Verifies every contract space and writes the marker of each space that verified, as `db sign` does |
| `dbInit(options)` | Initializes database schema from contract |
| `dbUpdate(options)` | Updates database schema to match contract |
| `migrate(options)` | Advances the database to the target contract via the migration graph |
| `introspect(options)` | Introspects database schema |

### Result Types

Operations return structured result types:

- `readMarker()` → `ContractMarkerRecord | null`
- `verify()` → `VerifyDatabaseResult`
- `schemaVerify()` → `VerifyDatabaseSchemaResult`
- `dbSign()` → `ExecuteDbSignResult`, a `Result` whose success lists one `DbSignSpaceOutcome` per contract space
- `dbInit()` → `Result<DbInitSuccess, DbInitFailure>` (uses Result pattern)
- `dbUpdate()` → `Result<DbUpdateSuccess, DbUpdateFailure>` (uses Result pattern)
- `migrate()` → `Result<MigrateSuccess, MigrateFailure>` (uses Result pattern)
- `introspect()` → Schema IR (family-specific)

### Error Handling

- **Connection errors**: Thrown as exceptions from `connect()`
- **Not connected errors**: Thrown if operations called before `connect()`
- **Driver not configured**: Thrown if driver is not provided in options
- **Operation failures**: Returned as structured results (not thrown)

### Key Differences from CLI

| Aspect | CLI | Control API |
|--------|-----|-------------|
| Config | Reads `prisma.config.ts` | Accepts descriptors directly |
| File I/O | Reads contract.json from disk | Accepts contract directly |
| Output | Formats for console | Returns structured data |
| Exit codes | Uses `process.exit()` | Returns results/throws |

## Entrypoints

The CLI package exports several subpaths for different use cases:

- **`@internal/cli`** (main export): Exports `loadContractFromTs` and `createContractEmitCommand`
- **`@internal/cli/config-types`**: Exports `defineConfig` and config types
- **`@internal/cli/control-api`**: Exports `createControlClient` and control API types
- **`@internal/cli/commands/db-init`**: Exports `createDbInitCommand`
- **`@internal/cli/commands/db-update`**: Exports `createDbUpdateCommand`
- **`@internal/cli/commands/db-schema`**: Exports `createDbSchemaCommand`
- **`@internal/cli/commands/db-sign`**: Exports `createDbSignCommand`
- **`@internal/cli/commands/db-verify`**: Exports `createDbVerifyCommand`
- **`@internal/cli/commands/contract-emit`**: Exports `createContractEmitCommand`
- **`@internal/cli/commands/contract-infer`**: Exports `createContractInferCommand`
- **`@internal/cli/commands/migration-plan`**: Exports `createMigrationPlanCommand`
- **`@internal/cli/commands/migration-show`**: Exports `createMigrationShowCommand`
- **`@internal/cli/commands/migration-status`**: Exports `createMigrationStatusCommand`
- **`@internal/cli/commands/migrate`**: Exports `createMigrateCommand`
- **`@internal/config-loader`**: Exports `loadConfig` (config + section-tagged diagnostics), `loadConfigForSections`, and `requireConfigSections`
- **`@internal/cli/control-api/testing`**: Exports `createFixtureControlClient`, a fixture-backed `ControlClient` double for host and product tests (no database or driver needed; published as `@prisma/orm-toolchain/cli/control-api/testing`). It keeps the real client's connection lifecycle: the operations the real client runs against a driver reject with `DRIVER.NOT_CONNECTED` until `connect()` is awaited, so a test that forgets to connect fails the same way production would.

**Important**: `loadContractFromTs` is exported from the main package (`@internal/cli`). See `.cursor/rules/cli-package-exports.mdc` for import patterns.

## Package Location

This package is part of the **framework domain**, **tooling layer**, **migration plane**:
- **Domain**: framework (target-agnostic)
- **Layer**: tooling
- **Plane**: migration
- **Path**: `packages/1-framework/3-tooling/cli`

## See Also

- [`@internal/emitter`](../emitter/README.md) - Contract emission engine
- Project Brief — CLI Support for Extension Packs: `docs/briefs/complete/20-CLI-Support-for-Extension-Packs.md`
