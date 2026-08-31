# @internal/target-postgres

Postgres target pack for Prisma Next.

## Package Classification

- **Domain**: targets
- **Layer**: targets
- **Plane**: multi-plane (migration, runtime)

## Purpose

Provides the Postgres target descriptor (`SqlControlTargetDescriptor`) for CLI config. The target descriptor includes capabilities and type information directly as properties, as well as factories for creating migration planners and runners.

## Responsibilities

- **Target Descriptor Export**: Exports the Postgres `SqlControlTargetDescriptor` for use in CLI configuration files
- **Descriptor-First Design**: All declarative fields (version, capabilities, types, operations) are properties directly on the descriptor, eliminating the need for separate manifest files
- **Multi-Plane Support**: Provides both migration-plane (control) and runtime-plane entry points for the Postgres target
- **Planner Factory**: Implements `migrations.createPlanner()` to create Postgres-specific migration planners
- **Runner Factory**: Implements `migrations.createRunner()` to create Postgres-specific migration runners
- **Contract-to-Schema**: Implements `migrations.contractToSchema()` which converts a contract's `SqlStorage` to `SqlSchemaIR` via the SQL family's `contractToSchemaIR`. Used by `migration plan` for offline planning without a database connection
- **Schema Verification Normalization**: Normalizes Postgres default expressions (for example, `nextval(...)`, `now()`) when verifying the post-apply schema
- **Postgres-Only Contract Extensions**: Defines Postgres-specific column defaults (e.g., sequences) used by the migration planner
- **Generated Defaults Policy**: Treats client-generated defaults as non-DB defaults when emitting DDL
- **Database Dependency Consumption**: The planner extracts database dependencies from the configured framework components (passed as `frameworkComponents`), verifies each dependency against the live schema, and only emits install operations when required. The runner reuses the same metadata for post-apply verification, so there are no hardcoded extension mappings—database dependencies stay component-owned.
- **Storage Type Planning**: The planner dispatches storage type hooks for `storage.types` and emits type operations before table creation when supported by the policy

This package spans multiple planes:
- **Migration plane** (`src/exports/control.ts`): Control plane entry point that exports `SqlControlTargetDescriptor` for config files
- **Runtime plane** (`src/exports/runtime.ts`): Runtime entry point for target-specific runtime code (future)
- **Authoring pack ref** (`src/exports/pack.ts`): Pure data surface for contract builder workflows

## `db init`

This package provides the Postgres implementation of the SQL migration planner/runner used by `prisma db init`:

- **Planner** (`src/core/migrations/planner.ts`): produces an additive-only `MigrationPlan` to bring the database schema in line with a destination contract. Extra unrelated schema is tolerated; non-additive mismatches (type/nullability/constraint incompatibilities) surface as structured conflicts. Storage type operations (from codec-owned hooks) are emitted before table operations when `storage.types` are present. The planner respects the contract's `foreignKeys` configuration: when `foreignKeys.constraints` is `false`, FK constraint operations are skipped; when `foreignKeys.indexes` is `false`, FK-backing indexes are omitted. See [ADR 161](../../../docs/architecture%20docs/adrs/ADR%20161%20-%20Explicit%20foreign%20key%20constraint%20and%20index%20configuration.md). The planner also emits `ON DELETE` and `ON UPDATE` referential action clauses when specified on foreign keys (see [ADR 166](../../../docs/architecture%20docs/adrs/ADR%20166%20-%20Referential%20actions%20for%20foreign%20keys.md)).
- **Runner** (`src/core/migrations/runner.ts`): executes a plan under an advisory lock, verifies the post-state schema, then writes the contract marker and appends a ledger entry in the `prisma_contract` schema.

For the CLI orchestration, see `packages/1-framework/3-tooling/cli/src/commands/db-init.ts`.

## Usage

### Control Plane (CLI)

```typescript
import postgres from '@internal/target-postgres/control';
import sqlFamilyDescriptor from '@internal/family-sql/control';
import postgresAdapter from '@internal/adapter-postgres/control';
import postgresDriver from '@internal/driver-postgres/control';

// postgres is a SqlControlTargetDescriptor with:
// - kind: 'target'
// - familyId: 'sql'
// - targetId: 'postgres'
// - id: 'postgres'
// - version: '0.0.1'
// - capabilities, types, operations (directly on descriptor)
// - migrations.createPlanner(): creates a Postgres migration planner
// - migrations.createRunner(): creates a Postgres migration runner

// Create family instance with target, adapter, and driver
const family = sqlFamilyDescriptor.create({
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensions: [],
});

// Include the active framework components so planner/runner can resolve
// component-owned database dependencies (e.g., extension installs).
const frameworkComponents = [postgres, postgresAdapter];

// Create planner and runner from target descriptor
const planner = postgres.migrations.createPlanner(family);
const runner = postgres.migrations.createRunner(family);

// Plan and execute migrations
const planResult = planner.plan({ contract, schema, policy, frameworkComponents });
if (planResult.kind === 'success') {
  const executeResult = await runner.execute({
    plan: planResult.plan,
    driver,
    destinationContract: contract,
    policy,
    frameworkComponents,
  });
  if (!executeResult.ok) {
    // Handle structured failure (e.g., EXECUTION_FAILED, PRECHECK_FAILED)
    console.error(executeResult.failure.code, executeResult.failure.summary);
  }
} else {
  // Handle planner failure (e.g., unsupportedOperation)
  console.error(planResult.conflicts);
}
```

### Pack refs for TypeScript contract authoring

```typescript
import postgresPack from '@internal/target-postgres/pack';
import pgvector from '@internal/extension-pgvector/pack';
import sqlFamily from '@internal/family-sql/pack';
import { defineContract } from '@internal/sql-contract-ts/contract-builder';

export const contract = defineContract({
  family: sqlFamily,
  target: postgresPack,
  extensions: { pgvector },
});
```

Pack refs are pure JSON-friendly objects that make TypeScript contract authoring work in both emit and no-emit workflows without requiring separate manifest files.

## Codec descriptor authoring

PostgreSQL-bound codecs use the public `PostgresCodecDescriptor` protocol, `postgresCodec(...)` adapter, and `definePostgresCodecs(...)` tuple helper exported from `@internal/target-postgres/codec-descriptor`. See the [codec authoring guide](../../../../docs/reference/codec-authoring-guide.md#target-owned-sql-codec-descriptors) for subclassing, generic adaptation, stack contribution, validation, array projection, and the current renderer transition.

## Architecture

This package provides both control and runtime entry points for the Postgres target. All declarative fields (version, capabilities, types, operations) are defined directly on the descriptor, so the published entry points never touch the filesystem. The `./pack` entry point provides a pure pack ref for contract authoring. The runtime entry point will provide target-specific runtime functionality in the future.

## Error Handling

Both the planner and runner return structured results instead of throwing:

**Planner** returns `PlannerResult` with either:
- `kind: 'success'` with a `MigrationPlan`
- `kind: 'failure'` with a list of `PlannerConflict` objects (e.g., `unsupportedOperation`, `policyViolation`)

**Runner** returns `MigrationRunnerResult` (`Result<MigrationRunnerSuccessValue, MigrationRunnerFailure>`) with either:
- `ok: true` with operation counts
- `ok: false` with a `MigrationRunnerFailure` containing error code, summary, and metadata

Runner error codes include: `EXECUTION_FAILED`, `PRECHECK_FAILED`, `POSTCHECK_FAILED`, `SCHEMA_VERIFY_FAILED`, `POLICY_VIOLATION`, `MARKER_ORIGIN_MISMATCH`, `DESTINATION_CONTRACT_MISMATCH`.

See `@internal/family-sql/control` README for full error code documentation.

## Exports

- `./control`: Control plane entry point for `SqlControlTargetDescriptor`
- `./runtime`: Runtime entry point for target-specific runtime code (future)
- `./pack`: Pure pack ref for `defineContract({ family, target: postgresPack, ... })`

## Tests

This package ships a mix of fast planner unit tests and slower runner integration tests that require a dev Postgres instance (via `@prisma/dev`).

- **Default (`pnpm --filter @internal/target-postgres test`)**: runs all tests including integration tests
- **Test files**:
  - `test/migrations/planner.behavior.test.ts`: Planner unit tests (classification, conflicts, dependency ops)
  - `test/migrations/planner.fk-config.test.ts`: Planner unit tests for FK constraint/index configuration combinations
  - `test/migrations/planner.referential-actions.test.ts`: Planner unit tests for ON DELETE/ON UPDATE DDL emission
  - `test/migrations/planner.integration.test.ts`: Planner integration tests
  - `test/migrations/runner.*.integration.test.ts`: Runner integration tests (basic, errors, idempotency, policy)

```bash
pnpm --filter @internal/target-postgres test
```
