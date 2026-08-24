# @internal/cli

> **For the CLI command, install [`@prisma/cli`](https://www.npmjs.com/package/@prisma/cli) (`@next` dist-tag).**
> The unified `prisma` binary mounts this package's `orm` command family;
> the standalone `prisma-next` npm package is no longer published. Inside this
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

Command-line interface for Prisma Next contract emission and management.

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

### `prisma contract infer`

Inspect the live database schema and write an inferred PSL contract to disk. Use this for brownfield adoption when you want a starting `contract.prisma` before running `contract emit` and `db sign`.

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

Mark the database as matching the emitted contract by writing or updating the contract marker. This command verifies that the database schema satisfies the contract before signing, ensuring the marker is only written when the database is fully aligned.

**Command:**
```bash
prisma db sign [--db <url>] [--config <path>] [--json] [-v] [-q] [--color/--no-color]
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
prisma db sign

# Specify database URL
prisma db sign --db postgresql://user:pass@localhost/db

# JSON output
prisma db sign --json

# Verbose output
prisma db sign -v
```

**Config File Requirements:**

The `db sign` command requires a `driver` in the config to connect to the database and a `contract.output` path to locate the emitted contract:

```typescript
import { defineConfig } from '@internal/cli/config-types';
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

**Signing Process:**

1. **Load Contract**: Reads the emitted `contract.json` from `config.contract.output`
2. **Connect to Database**: Uses `config.driver.create(url)` to create a driver
3. **Create Family Instance**: Creates a `ControlStack` via `createControlStack()` and passes it to `config.family.create(stack)` to create a family instance
4. **Schema Verification (Precondition)**: Calls `familyInstance.schemaVerify()` to verify the database schema matches the contract:
   - If verification fails: Prints schema verification output and exits with code 1 (marker is not written)
   - If verification passes: Proceeds to marker signing
5. **Sign**: Calls `familyInstance.sign()` which:
   - Ensures the marker schema and table exist
   - Reads any existing marker from the database
   - Compares contract hashes with existing marker:
     - If marker is missing: Inserts a new marker row
     - If hashes differ: Updates the existing marker row
     - If hashes match: No-op (idempotent)

**Output Format (TTY):**

Success (new marker):
```
✔ Database signed (marker created)
  storageHash: abc123...
  profileHash: def456...
  Total time: 42ms
```

Success (updated marker):
```
✔ Database signed (marker updated from old-hash)
  storageHash: abc123...
  profileHash: def456...
  previous storageHash: old-hash
  Total time: 42ms
```

Success (already up-to-date):
```
✔ Database already signed with this contract
  storageHash: abc123...
  profileHash: def456...
  Total time: 42ms
```

Failure (schema mismatch):
```
✖ Schema verification failed
  [Schema verification tree output]
```

**Output Format (JSON):**

```json
{
  "ok": true,
  "summary": "Database signed (marker created)",
  "contract": {
    "storageHash": "abc123...",
    "profileHash": "def456..."
  },
  "target": {
    "expected": "postgres",
    "actual": "postgres"
  },
  "marker": {
    "created": true,
    "updated": false
  },
  "meta": {
    "configPath": "/path/to/prisma.config.ts",
    "contractPath": "/path/to/src/prisma/contract.json"
  },
  "timings": {
    "total": 42
  }
}
```

For updated markers:
```json
{
  "ok": true,
  "summary": "Database signed (marker updated from old-hash)",
  "contract": {
    "storageHash": "abc123...",
    "profileHash": "def456..."
  },
  "target": {
    "expected": "postgres",
    "actual": "postgres"
  },
  "marker": {
    "created": false,
    "updated": true,
    "previous": {
      "storageHash": "old-hash",
      "profileHash": "old-profile-hash"
    }
  },
  "meta": {
    "configPath": "/path/to/prisma.config.ts",
    "contractPath": "/path/to/src/prisma/contract.json"
  },
  "timings": {
    "total": 42
  }
}
```

**Error Codes:**
- `PN-CLI-4010`: Missing driver in config — provide a driver descriptor
- `PN-CLI-4005`: Missing database connection — provide `--db <url>` or set `db.connection` in config
- Exit code 1: Schema verification failed — database schema does not match contract (marker is not written)

**Relationship to Other Commands:**
- **`db verify`**: `db verify` checks that the marker exists and matches the contract, then runs schema verification by default. `db sign` writes the marker that `db verify` checks. Use `db verify --marker-only` for marker-only verification and `db verify --schema-only` to inspect only the live schema.

**Idempotency:**
The `db sign` command is idempotent and safe to run multiple times:
- If the marker already matches the contract (same hashes), no database changes are made
- The command reports success in all cases (new marker, updated marker, or already up-to-date)
- Safe to run in CI/deployment pipelines

**Family Requirements:**
The family must provide a `create()` method in the family descriptor that returns a `ControlFamilyInstance` with `schemaVerify()` and `sign()` methods:

```typescript
interface ControlFamilyInstance {
  schemaVerify(options: {
    driver: ControlDriverInstance;
    contract: Contract;
    strict: boolean;
    contractPath: string;
    configPath?: string;
  }): Promise<VerifyDatabaseSchemaResult>;

  sign(options: {
    driver: ControlDriverInstance;
    contract: Contract;
    contractPath: string;
    configPath?: string;
  }): Promise<SignDatabaseResult>;
}
```

The SQL family provides this via `@internal/family-sql/control`. The `sign()` method handles ensuring the marker schema/table exist, reading existing markers, comparing hashes, and writing/updating markers internally.

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
- In interactive mode, destructive plans require confirmation before apply
- In non-interactive mode, destructive plans fail unless `-y, --yes` is provided

**Command:**
```bash
prisma db update [--db <url>] [--config <path>] [--dry-run] [-y|--yes] [--interactive|--no-interactive] [--json] [-v] [-q] [--color/--no-color]
```

**Error codes (additional to shared CLI/runtime codes):**
- `RUNNER_FAILED`: runner rejected apply (origin mismatch, failed checks, policy failures, or execution errors)

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
prisma migration plan [--config <path>] [--name <slug>] [--from <contract>] [--to <contract>] [--json] [-v] [-q] [--color/--no-color]
```

**Options:**
- `--config <path>`: Path to `prisma.config.ts`
- `--name <slug>`: Name slug for the migration directory (default: `migration`)
- `--from <contract>`: Starting contract reference (hash, prefix, ref name, migration directory, `<dir>^`, or filesystem path). Defaults to the `db` ref (greenfield when absent).
- `--to <contract>`: Destination contract reference (same grammar as `--from`). Defaults to the emitted `contract.json`. Use `--to <migration-dir>^` to plan a rollback toward a predecessor state.
- `--json`: Output as JSON object
- `-q, --quiet`: Quiet mode (errors only)
- `-v, --verbose`: Verbose output (debug info, timings)

**What it does:**
1. Loads config and resolves the destination contract: `--to <contract>` if provided, otherwise `contract.json`
2. Reads existing migrations from `config.migrations.dir` (default: `migrations/`)
3. Determines the starting point: `--from <contract>` if provided, otherwise the `db` ref (greenfield when absent)
4. Diffs the starting contract against the destination using the target's migration planner
5. Scaffolds a new migration package: `migration.ts` (containing `placeholder(...)` lambdas for any data transforms), `migration.json` (with a content-addressed `migrationHash` over the planned ops, or over `[]` when the planner could not lower any calls because of placeholders), and `ops.json` (the planned ops, or `[]` in the placeholder-blocked case). The bookend contracts are written write-if-absent into the shared snapshot store at `migrations/snapshots/<hex>/contract.{json,d.ts}`. The package is **always** fully attested — there is no draft state on disk.
6. If the plan has unfilled `placeholder(...)` slots, the command returns a successful `pendingPlaceholders` envelope (a warning, not a failure) asking the developer to fill in the slots before re-emitting. The on-disk `ops.json` is `[]` and `migrationHash` is the hash of `(metadata, [])`, so applying the migration as-written will not advance the storage hash to the intended destination — the runner's destination-hash post-check surfaces this as a state mismatch. After filling in the placeholders, run `node migrations/<dir>/migration.ts` to re-emit `ops.json` and the corresponding `migrationHash`. `PN-MIG-2001` is raised only at self-emit time when a slot is still unfilled.

**Outputs:**
- `migrations/<dir>/migration.ts` — editable migration source (with `placeholder(...)` slots when the planner inserted them)
- `migrations/<dir>/migration.json` — fully attested metadata (`migrationHash: string`, never null)
- `migrations/<dir>/ops.json` — planned operations (empty list `[]` if placeholders blocked the planner)
- `migrations/snapshots/<hex>/contract.{json,d.ts}` — bookend contracts, written write-if-absent, keyed by each contract's storage hash (one entry for `from` when applicable, one for `to`)

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

Show the migration graph and applied status. Adapts based on context:

- **With DB connection**: Shows applied/pending markers and "you are here" indicators
- **Without DB connection**: Shows the graph structure from disk only
- **With `--ref`**: Targets a specific ref instead of the contract hash; all refs from `refs.json` are rendered on the graph

```bash
prisma migration status [--db <url>] [--ref <name>] [--config <path>] [--json] [-v] [-q] [--color/--no-color]
```

**Options:**
- `--db <url>`: Database connection string (enables online mode)
- `--ref <name>`: Target a named ref from `migrations/refs.json` instead of the current contract hash
- `--config <path>`: Path to `prisma.config.ts`
- `--json`: Output as JSON object
- `-q, --quiet`: Quiet mode (errors only)
- `-v, --verbose`: Verbose output

**What it does:**
1. Reads migration packages from disk and reconstructs the migration graph
2. Loads all refs from `migrations/refs.json` (if present) and renders them on the graph
3. If `--ref` is provided, uses the ref's hash as the target instead of the contract hash; the active ref is highlighted in bold, other refs are dimmed
4. If a DB connection is available, reads the marker to determine applied/pending status and shows distance from the ref target (e.g., "2 edge(s) behind ref")
5. Displays the graph with `◄ DB`, `◄ Contract`, and `◄ ref:<name>` markers
6. Shows operation summaries with destructive operation highlighting
7. In `--ref` mode, the `CONTRACT.AHEAD` warning is suppressed — contract being ahead of a ref target is expected in multi-environment workflows

**Branched graphs:** When the migration graph has multiple branches (divergence), status reports an `AMBIGUOUS_TARGET` error with the divergence point and branch details. Use `--ref` to target a specific branch.

### `prisma db migrate`

Apply planned migrations to the database. Executes previously planned migrations (created by `migration plan`). Compares the database marker against the migration graph to determine which migrations are pending, then executes them sequentially. Each migration runs in its own transaction. Does not plan new migrations — run `migration plan` first.

```bash
prisma db migrate [--db <url>] [--to <contract>] [--config <path>] [--json] [-v] [-q] [--color/--no-color]
```

**Options:**
- `--db <url>`: Database connection string (optional; defaults to `config.db.connection`)
- `--to <contract>`: Target contract reference (hash, prefix, ref name, migration directory, `<dir>^`, or filesystem path). When omitted, applies toward the emitted `contract.json`. When `--to` resolves to an on-disk graph node, verification and apply use the snapshot store entry for that node's hash — so a planned rollback or other arbitrary-target edge applies without editing contract source.
- `--ref <name>`: Target a named ref from `migrations/refs.json` instead of the current contract hash
- `--config <path>`: Path to `prisma.config.ts`
- `--json`: Output as JSON object
- `-q, --quiet`: Quiet mode (errors only)
- `-v, --verbose`: Verbose output (debug info, timings)

**What it does:**
1. Reads migration packages from `config.migrations.dir`. Every package is attested — there is no on-disk draft state. The loader (`readMigrationPackage` in `@internal/migration-tools/io`) rehashes `(metadata, ops)` for each `MigrationPackage` it returns and confirms the result matches the stored `migrationHash`. If a package has been hand-edited or partially written since emit, the load fails with `MIGRATION.HASH_MISMATCH` pointing at the offending directory and asks the developer to re-run `node migrations/<dir>/migration.ts` (or restore from version control).
2. Reconstructs the migration graph from all loaded packages
3. Determines the destination hash and apply contract: from `--to` / `--ref`, or from `contract.json` when neither is supplied
4. Connects to the database and reads the current marker hash
5. Finds the shortest path from the marker hash to the destination using graph pathfinding
6. Executes each pending migration in order using the target's `MigrationRunner`
7. Each migration runs in its own transaction with prechecks, postchecks, and idempotency checks enabled
8. After each migration, the runner runs the migration's post-checks and verifies the resulting state matches the target contract's storage hash, then updates the marker/ledger

**Rollback workflow:** When no on-disk edge reaches the target (for example `db migrate --to <migration-dir>^`), the command refuses with `MIGRATION.PATH_UNREACHABLE` and suggests planning the missing edge with `migration plan --from <current> --to <target> --name <slug>`, then re-running `db migrate --to <target>`. No contract-source edit is required.

**Config requirements:** Requires `driver` and `db.connection` (or `--db`). `migrations.dir` is optional and defaults to `migrations/`.

**Resume semantics:** If a migration fails, previously applied migrations are preserved. Re-running `db migrate` resumes from the last successful migration.

**Ref-based routing:** With `--ref`, apply targets the ref's hash instead of the contract hash. This enables multi-environment workflows where staging and production track different points in the migration graph.

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

Manage named refs in `migrations/refs.json`. Refs map logical environment names (e.g., `staging`, `production`) to contract hashes, enabling multi-environment migration workflows where different environments track different points in the migration graph.

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

**Atomic writes:** `refs.json` is written atomically via temp file + rename to prevent corruption from concurrent writes.

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

The `validateContractDeps` warning is returned in `ContractEmitResult.validationWarning`
rather than written to stderr by the operation — callers (CLI, Vite plugin) decide
how to render it (`ui.warn`, plugin logger, etc.).

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
      - `types.storage`: Storage type bindings (`typeId`, `nativeType`, etc.) used in authoring/emission.
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

## Dependencies

- **`@prisma/cli-engine`**: Command tree, argument parsing, help, settlement, telemetry hooks
- **`clipanion`**: Flag parsing for the per-migration `MigrationCLI.run` entrypoint only
- **`esbuild`**: Bundling TypeScript contract files with import allowlisting
- **`@internal/emitter`**: Contract emission engine (returns strings)
- **`@internal/migration-tools`**: On-disk migration I/O, hash verification, and history reconstruction
- **`@internal/framework-components`**: Control plane types, migration operation types, control stack (via `./control`)
- **`@internal/errors`**: Error types and factories (via `./control`)

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
  const initResult = await client.dbInit({ contract, mode: 'apply' });
  const updateResult = await client.dbUpdate({ contract, mode: 'apply' });
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
| `sign(options)` | Writes contract marker to database |
| `dbInit(options)` | Initializes database schema from contract |
| `dbUpdate(options)` | Updates database schema to match contract |
| `migrate(options)` | Advances the database to the target contract via the migration graph |
| `introspect(options)` | Introspects database schema |

### Result Types

Operations return structured result types:

- `readMarker()` → `ContractMarkerRecord | null`
- `verify()` → `VerifyDatabaseResult`
- `schemaVerify()` → `VerifyDatabaseSchemaResult`
- `sign()` → `SignDatabaseResult`
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
