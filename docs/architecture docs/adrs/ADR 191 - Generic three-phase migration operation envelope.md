# ADR 191 — Generic three-phase migration operation envelope and family-provided serialization

**Status:** Accepted, not yet implemented.

## At a glance

When we built Mongo migrations, we defined this operation interface:

```ts
interface MongoMigrationPlanOperation extends MigrationPlanOperation {
  readonly precheck: readonly MongoMigrationCheck[];
  readonly execute: readonly MongoMigrationStep[];
  readonly postcheck: readonly MongoMigrationCheck[];
}
```

The SQL family already had an identical structure:

```ts
interface SqlMigrationPlanOperation<TTargetDetails> extends MigrationPlanOperation {
  readonly precheck: readonly SqlMigrationPlanOperationStep[];
  readonly execute: readonly SqlMigrationPlanOperationStep[];
  readonly postcheck: readonly SqlMigrationPlanOperationStep[];
}
```

Same array names, same three-phase semantics, same relationship to the framework base type. The only difference is the content of each step and check — SQL steps carry `sql: string`, Mongo steps carry `command: AnyMongoDdlCommand`.

The framework's `MigrationPlanOperation` base type knows nothing about this structure:

```ts
interface MigrationPlanOperation {
  readonly id: string;
  readonly label: string;
  readonly operationClass: MigrationOperationClass;
}
```

This means every family independently defines the envelope, independently serializes it, and the CLI has a `switch(familyId)` to format operations for display. A third family would have to copy the same pattern again.

## Decision

Extract the three-phase structure into the framework as a generic. Families provide only the content types (step and check) and a serializer — the framework owns the envelope shape.

```ts
interface MigrationPlanOperation<TStep, TCheck> {
  readonly id: string;
  readonly label: string;
  readonly operationClass: MigrationOperationClass;
  readonly precheck: readonly TCheck[];
  readonly execute: readonly TStep[];
  readonly postcheck: readonly TCheck[];
}
```

SQL instantiates this as `MigrationPlanOperation<SqlStep, SqlCheck>`. Mongo instantiates it as `MigrationPlanOperation<MongoMigrationStep, MongoMigrationCheck>`. A future family implements its own step and check types and plugs into the same envelope.

### Serialization SPI

The framework needs to serialize and deserialize operations to/from `ops.json`, but it doesn't know the concrete step and check types. Each family provides a serializer:

```ts
interface MigrationOperationSerializer<TStep, TCheck> {
  serializeStep(step: TStep): Record<string, unknown>;
  serializeCheck(check: TCheck): Record<string, unknown>;
  deserializeStep(json: Record<string, unknown>): TStep;
  deserializeCheck(json: Record<string, unknown>): TCheck;
}
```

The framework handles the envelope (`id`, `label`, `operationClass`, array structure) and delegates each step/check to the family-provided serializer. This replaces the current pattern where each family serializes the entire operation independently.

The serialization SPI is needed because the content types vary in complexity. SQL steps are plain strings (`{ sql: "CREATE INDEX ..." }`), but Mongo steps contain frozen class instances that must be rehydrated from `kind` discriminants (see [ADR 188](ADR%20188%20-%20MongoDB%20migration%20operation%20model.md)). The framework can't handle both without family-specific logic.

### CLI display

The `switch(familyId)` in the CLI's `extractOperationStatements` is replaced by a method on `TargetMigrationsCapability`:

```ts
interface TargetMigrationsCapability<...> {
  formatOperationStatements?(operations: readonly MigrationPlanOperation<unknown, unknown>[]): string[];
}
```

The CLI calls `targetDescriptor.migrations.formatOperationStatements(ops)` when available. Each family provides a formatter that knows how to render its step types as display strings — SQL renders SQL statements, Mongo renders `db.collection.createIndex(...)` shell commands.

## What changes (when implemented)

- `MigrationPlanOperation` in `@internal/framework-components` would become generic over `TStep` and `TCheck`.
- A `MigrationOperationSerializer` SPI would be added to `@internal/framework-components`.
- `TargetMigrationsCapability` would gain an optional `formatOperationStatements` method.
- SQL and Mongo families would conform to the generic, removing their independent envelope definitions.
- The CLI `switch(familyId)` dispatch would be replaced by the capability method.

## What doesn't change

- The runner loop (precheck → execute → postcheck, after a first postcheck pass that skips an applied operation; see [ADR 038](ADR%20038%20-%20Operation%20idempotency%20classification%20&%20enforcement.md)) — same semantics, same three-phase flow.
- The `ops.json` plan file format — same JSON structure, same fields.
- The rehydration model described in [ADR 188](ADR%20188%20-%20MongoDB%20migration%20operation%20model.md) — the deserializer still reconstructs live AST objects from `kind` discriminants.
- The composability property — users and extension packs can still assemble operations from primitives.

This is a type-level refactor that eliminates duplication, not a behavioral change.

## Alternatives considered

### Keep the duplication

There are only two families today. The parallel structure is easy to maintain by convention, and adding a generic introduces type-parameter complexity to every consumer of `MigrationPlanOperation`. We chose to extract anyway because:

- The duplication extends beyond the type: each family also duplicates the serializer and the CLI has a `switch` for formatting. The generic eliminates all three.
- A third family (DynamoDB, Cosmos, etc.) would need to discover and replicate the pattern. The generic makes the contract explicit.
- The cost is low — the generic is a straightforward type parameter addition with no runtime impact.

### Framework owns execution semantics, not just the envelope

Instead of a generic envelope with family-provided content, the framework could define a generic runner loop that dispatches steps and checks via family-provided executors. This goes further than the envelope refactor — it would centralize the precheck → execute → postcheck loop itself. We chose not to because:

- The execution semantics differ in important ways. SQL steps are executed as SQL statements via a driver. Mongo steps are dispatched via visitor to a command executor. Abstracting over both would require a generic executor interface that adds complexity without meaningful code sharing.
- The current design gives families full control over execution, which is important for target-specific error handling and transaction boundaries.
