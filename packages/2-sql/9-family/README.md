# @internal/family-sql

SQL family descriptor for Prisma Next.

## Purpose

Provides the SQL family descriptor (`ControlFamilyDescriptor`) that includes:
- The SQL target family hook (`sqlEmission`)
- Factory method (`create()`) to create family instances

## Responsibilities

- **Family Descriptor Export**: Exports the SQL `ControlFamilyDescriptor` for use in CLI configuration files
- **Family Instance Creation**: Creates `SqlFamilyInstance` objects that implement control-plane domain actions (`verify`, `schemaVerify`, `introspect`, `emitContract`, `deserializeContract`)
- **Planner & Runner SPI**: Owns the `MigrationPlanner` / `MigrationRunner` interfaces plus the `SqlControlTargetDescriptor` helper so targets can expose planners and runners (e.g., Postgres init planner/runner)
- **Family Hook Integration**: Integrates the SQL target family hook (`sqlEmission`) from `@internal/sql-contract-emitter`
- **Control Plane Entry Point**: Serves as the control plane entry point for the SQL family, enabling the CLI to select the family hook and create family instances
- **Contract-to-SchemaIR Conversion**: Converts `SqlStorage` from a contract into `SqlSchemaIR` for offline migration planning, enabling `migration plan` to work without a database connection
- **Destructive Change Detection**: Compares two `SqlStorage` values and identifies destructive changes (dropped tables/columns) for migration policy enforcement
- **Storage Type Control Hooks**: Extracts codec-owned control hooks for planning/verification/introspection of `storage.types` without adding enum-specific fields to shared IR
- **Codec Ownership**: Enforces a single owner per `codecId` for parameterized renderers and control-plane hooks to prevent ambiguous conflicts during assembly
- **Authoring Contribution Assembly**: Assembles authoring contributions (type constructors, field presets) from composed components for PSL interpretation
- **Parameterized Type Verification**: Expands contract `typeParams` into expected native type strings during schema verification and flags missing parameters as type mismatches
- **Schema Defaults Policy**: Ignores execution mutation defaults during schema verification since they are applied before DB writes
- **Foreign Key Config Awareness**: Schema verification respects the contract's `foreignKeys` configuration — when `foreignKeys.constraints` is `false`, FK constraint checks are skipped during verification (see [ADR 161](../../../docs/architecture%20docs/adrs/ADR%20161%20-%20Explicit%20foreign%20key%20constraint%20and%20index%20configuration.md))
- **Referential Action Verification**: When a contract FK specifies `onDelete` or `onUpdate`, the verifier compares them against the introspected schema and reports `foreign_key_mismatch` on mismatch (see [ADR 166](../../../docs/architecture%20docs/adrs/ADR%20166%20-%20Referential%20actions%20for%20foreign%20keys.md))

## Usage

```typescript
import sql from '@internal/family-sql/control';
import { createControlStack } from '@internal/framework-components/control';

// sql is a ControlFamilyDescriptor with:
// - kind: 'family'
// - id: 'sql'
// - familyId: 'sql'
// - hook: TargetFamilyHook
// - create: (stack) => SqlFamilyInstance

// Build a control stack (assembles all contributions from components)
const stack = createControlStack({
  family: sql,
  target: postgresTargetDescriptor,
  adapter: postgresAdapterDescriptor,
  driver: postgresDriverDescriptor,
  extensions: [pgVectorExtensionDescriptor],
});

// Create a family instance for control-plane operations
const familyInstance = sql.create(stack);

// Use instance methods for domain actions
const contract = familyInstance.deserializeContract(contractJson);
const verifyResult = await familyInstance.verify({ driver, contract, ... });

// Targets that implement SqlControlTargetDescriptor can build planners
const planner = postgresTargetDescriptor.migrations.createPlanner(familyInstance);
const planResult = planner.plan({
  contract: sqlContract,
  schema,
  policy,
  frameworkComponents: [postgresTargetDescriptor, postgresAdapterDescriptor, pgVectorExtensionDescriptor],
});

// Targets also provide runners for executing plans
const runner = postgresTargetDescriptor.migrations.createRunner(familyInstance);
const executeResult = await runner.execute({
  plan: planResult.plan,
  driver,
  destinationContract: sqlContract,
  frameworkComponents: [postgresTargetDescriptor, postgresAdapterDescriptor, pgVectorExtensionDescriptor],
});

// PSL contribution assembly (scalar type descriptors, mutation defaults, authoring
// contributions, codec lookup) is handled at the framework level by createControlStack.
// The CLI passes assembled contributions via ContractSourceContext when calling
// contract source providers — no manual assembly needed in user configs.

// executeResult is a Result<MigrationRunnerSuccessValue, MigrationRunnerFailure>
if (executeResult.ok) {
  console.log(`Executed ${executeResult.value.operationsExecuted} operations`);
} else {
  console.error(`Migration failed: ${executeResult.failure.code} - ${executeResult.failure.summary}`);
}
```

## Architecture

This package is the control plane entry point for the SQL family. It composes:
- `@internal/sql-contract-emitter` - Provides the SQL family hook
- `@internal/sql-operations` - SQL operation signature types
- `@internal/sql-contract` - SQL contract types and validation

The framework CLI uses this descriptor to:
1. Create family instances for control-plane operations (via `create()`)

Family instances implement domain actions:
- **`deserializeContract(contractJson)`**: Validates and normalizes contract, returns `Contract` without mappings
- **`verify()`**: Verifies database marker against contract (compares target, storageHash, profileHash)
- **`schemaVerify()`**: Verifies database schema against contract (compares contract requirements vs live schema)
- **`introspect()`**: Introspects database schema and returns `SqlSchemaIR`
- **`toSchemaView(schema)`**: Projects `SqlSchemaIR` into `CoreSchemaView` for human-readable display. Always displays native database types (e.g., `int4`, `text`) rather than mapped codec IDs (e.g., `pg/int4@1`) to reflect actual database state.
- **`emitContract({ contract })`**: Emits contract JSON and DTS as strings. Handles stripping mappings and validation internally. Uses preassembled state (operation registry, type imports, extension IDs).

The descriptor is "pure data + factory" - it only provides the hook and factory method. All family-specific logic lives on the instance.

## Package Structure

- **`src/core/control-descriptor.ts`**: `SqlFamilyDescriptor` class implementing `ControlFamilyDescriptor` interface (pure data + factory)
- **`src/core/control-instance.ts`**: `createSqlFamilyInstance` function that creates `SqlFamilyInstance` with domain action methods (`deserializeContract`, `verify`, `schemaVerify`, `introspect`, `toSchemaView`, `emitContract`). Contains `convertOperationManifest` function used internally by instance creation and test utilities in the same package.
- **`src/core/assembly.ts`**: Assembly helpers for extracting type imports, collecting codec-owned storage type control hooks, and composing mutation-default registries with duplicate detection.
- **`src/core/verify.ts`**: Verification helpers (`parseContractMarkerRow`, `collectSupportedCodecTypeIds`)
- **`src/core/control-adapter.ts`**: SQL control adapter interface (`SqlControlAdapter`) for control-plane operations
- **`src/core/migrations/`**: Migration IR helpers plus planner and runner SPI types (`MigrationPlanner`, `MigrationRunner`, `SqlControlTargetDescriptor`). Runners return `MigrationRunnerResult` which is a union of success/failure.
- **`src/core/migrations/contract-to-schema-ir.ts`**: `contractToSchemaIR(contract, { annotationNamespace, ... })` converts a contract to `SqlSchemaIR` for offline migration planning (used by `migration plan` to synthesize the "from" schema without a database connection). Also exports `detectDestructiveChanges(from, to)` which compares two `SqlStorage` values and returns a list of destructive changes (dropped tables, dropped columns) for migration policy enforcement.

### Migration Runner Error Codes

The runner returns structured errors with the following codes:

- **`DESTINATION_CONTRACT_MISMATCH`**: Plan destination hash doesn't match provided contract hash
- **`MARKER_ORIGIN_MISMATCH`**: Existing marker doesn't match plan's expected origin
- **`POLICY_VIOLATION`**: Operation class is not allowed by the plan's policy
- **`PRECHECK_FAILED`**: Operation precheck returned false
- **`POSTCHECK_FAILED`**: Operation postcheck returned false after execution
- **`SCHEMA_VERIFY_FAILED`**: Resulting schema doesn't satisfy the destination contract
- **`EXECUTION_FAILED`**: SQL execution error during operation execution
- **`src/exports/control.ts`**: Control plane entry point (exports `SqlFamilyDescriptor` instance)
- **`src/exports/runtime.ts`**: Runtime plane entry point

## Entrypoints

- **`./control`**: Control plane entry point for CLI/config usage (exports `SqlFamilyDescriptor`)
- **`./control-adapter`**: SQL control adapter interface (`SqlControlAdapter`, `SqlControlAdapterDescriptor`) for target-specific adapters
- **`./runtime`**: Runtime plane identity exports only (family ID, types, descriptor identity). Does **not** export runtime creation helpers—use `instantiateExecutionStack` from `@internal/framework-components/execution` and `createExecutionContext`, `createRuntime`, `createSqlExecutionStack` from `@internal/sql-runtime`. See [ADR 152](../../../docs/architecture%20docs/adrs/ADR%20152%20-%20Execution%20Plane%20Descriptors%20and%20Instances.md).
- **`./verify`**: Marker row parsing helper (`parseContractMarkerRow`). Marker reads are owned by each `SqlControlAdapter` (e.g. `PostgresControlAdapter.readMarker`) so dialect-specific SQL stays target-local.

## How to debug `db init`

- **CLI orchestration**: `packages/1-framework/3-tooling/cli/src/commands/db-init.ts`
- **Planner/runner SPI types**: `packages/2-sql/3-tooling/family/src/core/migrations/types.ts`
- **Pure schema verifier (used by planner + runner)**: `@internal/family-sql/schema-verify` (source: `packages/2-sql/3-tooling/family/src/core/schema-verify/`)
- **Postgres implementation**:
  - Planner: `packages/3-targets/3-targets/postgres/src/core/migrations/planner.ts`
  - Runner: `packages/3-targets/3-targets/postgres/src/core/migrations/runner.ts`
- **Tests**:
  - CLI integration: `test/integration/test/cli.db-init.e2e.test.ts`
  - Target unit/integration: `packages/3-targets/3-targets/postgres/test/migrations/*`
