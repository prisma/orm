# ADR 198 — Migration runner decoupled from driver via visitor SPIs

## At a glance

The migration runner executes DDL commands, evaluates checks, and updates the marker. All of those operations ultimately talk to MongoDB — but the runner itself never sees a `Db` handle. Here is what it receives at construction:

```ts
export interface MongoRunnerDependencies {
  readonly inspectionExecutor: MongoInspectionCommandVisitor<Promise<Record<string, unknown>[]>>;
  readonly adapter: MongoAdapter;
  readonly driver: MongoDriver;
  readonly executeDdl: (command: AnyMongoDdlCommand) => Promise<void>;
  readonly markerOps: MarkerOperations;
  readonly introspectSchema: () => Promise<MongoSchemaIR>;
}
```

Every dependency is an abstract interface or a function over family-layer types. `MongoInspectionCommandVisitor` is the visitor SPI from `@internal/mongo-query-ast`. `MongoAdapter` and `MongoDriver` are the runtime query-execution abstractions already used by the rest of the system. `executeDdl` runs one DDL command from the `@internal/mongo-query-ast` command union, and `introspectSchema` reads the live database as a `MongoSchemaIR`. `MarkerOperations` is a small interface covering the four marker-ledger calls. The runner has zero imports from `mongodb`.

The concrete implementations live in the adapter (`@internal/adapter-mongo`). The `MongoControlAdapter` SPI in the family layer (`@internal/family-mongo/control-adapter`) declares the method that builds them for one control driver, and `MongoControlAdapterImpl` implements it:

```ts
// family-mongo/src/core/control-adapter.ts
export interface MongoControlAdapter<TTarget extends string = string>
  extends ControlAdapterInstance<'mongo', TTarget> {
  // ...marker-ledger CAS operations and introspectSchema
  createRunnerDependencies(
    driver: ControlDriverInstance<'mongo', TTarget>,
  ): MongoRunnerDependencies;
}

// adapter-mongo/src/core/mongo-control-adapter.ts
createRunnerDependencies(driver: ControlDriverInstance<'mongo', 'mongo'>): MongoRunnerDependencies {
  const controlDriver = requireMongoControlDriver(driver);
  return {
    inspectionExecutor: new MongoInspectionExecutor(controlDriver.db),
    adapter: this.#adapter,
    driver: controlDriver,
    executeDdl: (command) => this.executeDdl(controlDriver, command),
    markerOps: {
      readMarker: (space) => this.readMarker(controlDriver, space),
      initMarker: (space, destination) => this.initMarker(controlDriver, space, destination),
      updateMarker: (space, expectedFrom, destination) =>
        this.updateMarker(controlDriver, space, expectedFrom, destination),
      writeLedgerEntry: (space, entry) => this.writeLedgerEntry(controlDriver, space, entry),
    },
    introspectSchema: () => this.introspectSchema(controlDriver),
  };
}
```

The family instance forwards the call to the control adapter it resolves from the control stack, and the target's `createRunner` asks the family for the dependencies:

```ts
// family-mongo/src/core/control-instance.ts
createRunnerDependencies(options): MongoRunnerDependencies {
  return getControlAdapter().createRunnerDependencies(asMongoDriver(options.driver));
}

// target-mongo/src/core/migrations/control-target.ts, inside createRunner(family)
cachedDeps ??= family.createRunnerDependencies({ driver });
return new MongoMigrationRunner(cachedDeps).execute({ ... });
```

The adapter's `createRunnerDependencies` is the only place in the system where the runner's dependencies meet concrete driver types. The target names neither the adapter nor the driver package.

## Decision

The runner depends on `MongoRunnerDependencies`, not on `mongodb`'s `Db` type: the inspection visitor, the runtime `MongoAdapter` and `MongoDriver`, the `executeDdl` function, the `MarkerOperations` interface, and `introspectSchema`. Every member is typed by the family layer (`@internal/mongo-query-ast`, `@internal/mongo-lowering`, `@internal/family-mongo`). Concrete implementations stay in the adapter, which builds them behind the family's `MongoControlAdapter` SPI; the target reaches them through the family instance.

This gives the runner a clean package-layer position. It lives in the target package (`@internal/target-mongo`), which sits above the family-layer types but below the adapter. A target-layer module must not import adapter or driver code, and the runner's dependencies are the only way it reaches the database.

### DDL execution

DDL commands — `CreateIndexCommand`, `DropIndexCommand`, `CreateCollectionCommand`, etc. — are frozen AST nodes from the `AnyMongoDdlCommand` union ([ADR 188](ADR%20188%20-%20MongoDB%20migration%20operation%20model.md)). For each execute step the runner calls `executeDdl(step.command)`. The adapter lowers the command to a wire command and the control driver runs it:

```ts
// adapter-mongo/src/core/mongo-control-adapter.ts
async executeDdl(driver: MongoDriver, command: AnyMongoDdlCommand): Promise<void> {
  const wire = await this.#adapter.lower({ command }, {});
  await driver.run(wire);
}
```

Exhaustiveness is checked where the command is lowered, not in the runner: the adapter's `lowerDdlCommand` switches over `command.kind` and ends in a `never` check, so a new command kind in the union does not compile until the adapter lowers it. The runner never knows what `createIndex` does at the driver level.

Inspection commands (`ListIndexesCommand`, `ListCollectionsCommand`) follow the same pattern. The runner calls `check.source.accept(inspectionExecutor)` and gets back `Record<string, unknown>[]`. The concrete `MongoInspectionExecutor` calls `db.collection(...).listIndexes().toArray()` or `db.listCollections().toArray()`.

### DML execution

Data-transform operations (backfills, field renames, etc.) do not go through the DDL visitor. They use the same adapter + driver transport that runtime queries use: the runner calls `adapter.lower(plan)` to get a wire command, then `driver.execute(wireCommand)` to run it. This is the standard query-execution path — no bespoke executor needed.

A separate DML executor that called `db.collection(...)` directly for data transforms would duplicate the command dispatch the adapter and driver already perform, and would add a `Db` dependency to the runner's interface. Both DDL and DML go through the existing abstractions instead.

### MarkerOperations

The runner needs to read, initialize, and CAS-update the migration marker, and append ledger entries ([ADR 190](ADR%20190%20-%20CAS-based%20concurrency%20and%20migration%20state%20storage%20for%20MongoDB.md)). These four operations are abstracted behind a `MarkerOperations` interface:

```ts
export interface MarkerOperations {
  readMarker(space: string): Promise<ContractMarkerRecord | null>;
  initMarker(
    space: string,
    destination: {
      readonly storageHash: string;
      readonly profileHash: string;
      readonly invariants?: readonly string[];
    },
  ): Promise<void>;
  updateMarker(
    space: string,
    expectedFrom: string,
    destination: {
      readonly storageHash: string;
      readonly profileHash: string;
      readonly invariants?: readonly string[];
    },
  ): Promise<boolean>;
  writeLedgerEntry(
    space: string,
    entry: {
      readonly edgeId: string;
      readonly from: string;
      readonly to: string;
      readonly migrationName: string;
      readonly migrationHash: string;
      readonly operations: readonly unknown[];
    },
  ): Promise<void>;
}
```

Every method takes the contract space, so each space addresses its own marker document ([ADR 212](ADR%20212%20-%20Contract%20spaces.md)).

The concrete implementation calls into the migration marker collection per [ADR 190](ADR%20190%20-%20CAS-based%20concurrency%20and%20migration%20state%20storage%20for%20MongoDB.md) — but the runner interacts only with the interface. This was the last remaining `Db` dependency in the runner; extracting it completed the decoupling.

### Composition site

The target descriptor's `mongoTargetDescriptor.migrations.createRunner(family)` is where the runner is assembled, but it holds no concrete types. On the first `execute()` it calls `family.createRunnerDependencies({ driver })`. The family instance resolves the `MongoControlAdapter` from the control stack and delegates to `createRunnerDependencies(driver)`, which the adapter implements with its executors and the control driver's `Db` handle. The target caches the resulting `MongoRunnerDependencies` for the driver and passes it to a fresh `MongoMigrationRunner` for each contract space it applies.

## Consequences

- **Testability.** The runner can be unit-tested with no `mongodb` dependency. Tests supply an `executeDdl` that records the commands it receives, in-memory `MarkerOperations`, and a stub inspection visitor.
- **Extensibility.** Adding a new DDL command kind means a new case in the adapter's `lowerDdlCommand` and a wire command for it — not a runner change. The runner's three-phase loop ([ADR 191](ADR%20191%20-%20Generic%20three-phase%20migration%20operation%20envelope.md)) is generic over the commands inside the envelope.
- **Layering.** The runner has no import from `mongodb`, and the target package imports neither the adapter nor the driver. `pnpm lint:deps` cannot enforce that: `architecture.config.json` maps the target package to the `extensions` domain and the adapter and driver to the `targets` domain, and `extensions` may import `targets`. The boundary is enforced by `packages/3-mongo-target/1-mongo-target/test/layering.test.ts`, which fails on any `@internal/adapter-mongo` or `@internal/driver-mongo` import in the target's sources.

## Alternatives considered

### Runner takes `Db` directly

The simplest option: pass `Db` to the runner's constructor and let it instantiate executors internally. This was the original design. We moved away from it because:

- It places the runner in the adapter layer (or forces the target layer to depend on `mongodb`), violating the package layering rules.
- It makes the runner untestable without a live MongoDB instance.
- It couples the runner to a specific driver version — swapping driver implementations (e.g., for Atlas serverless) would require modifying the runner.

### A DDL command visitor in the runner

The runner could dispatch each DDL command to an adapter-side executor through a visitor, `step.command.accept(commandExecutor)`, with one visitor method per command kind so that a new kind fails to compile at the executor. That executor would duplicate the per-kind dispatch the adapter's lowering already performs. `executeDdl` lowers the command and runs the wire command on the driver, and `lowerDdlCommand` ends in a `never` check over `command.kind`, which keeps the exhaustiveness guarantee. Inspection commands keep a visitor, because they return documents rather than lowering to a wire command.

### Marker operations as a separate service

Rather than injecting `MarkerOperations` alongside the command visitors, the marker could be managed by a separate framework-level service that the runner calls indirectly. We chose direct injection because the marker is tightly coupled to the runner's execution loop — reading it before operations, CAS-updating it after. An extra layer of indirection would add complexity without enabling any meaningful reuse.
