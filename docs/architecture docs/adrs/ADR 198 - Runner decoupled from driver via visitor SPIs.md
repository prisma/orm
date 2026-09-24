# ADR 198 — Migration runner decoupled from driver via visitor SPIs

## At a glance

The migration runner executes DDL commands, evaluates checks, and updates the marker. All of those operations ultimately talk to MongoDB — but the runner itself never sees a `Db` handle. Here is what it receives at construction:

```ts
export interface MongoRunnerDependencies {
  readonly commandExecutor: MongoDdlCommandVisitor<Promise<void>>;
  readonly inspectionExecutor: MongoInspectionCommandVisitor<Promise<Record<string, unknown>[]>>;
  readonly adapter: MongoAdapter;
  readonly driver: MongoDriver;
  readonly markerOps: MarkerOperations;
}
```

Every dependency is an abstract interface. `MongoDdlCommandVisitor` and `MongoInspectionCommandVisitor` are the visitor SPIs from `@internal/mongo-query-ast`. `MongoAdapter` and `MongoDriver` are the runtime query-execution abstractions already used by the rest of the system. `MarkerOperations` is a small interface covering the four marker-ledger calls. The runner has zero imports from `mongodb`.

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

// target-mongo/src/core/control-target.ts, inside createRunner(family)
cachedDeps ??= family.createRunnerDependencies({ driver });
return new MongoMigrationRunner(cachedDeps).execute({ ... });
```

The adapter's `createRunnerDependencies` is the only place in the system where the runner's dependencies meet concrete driver types. The target names neither the adapter nor the driver package.

## Decision

The runner depends on abstract visitor interfaces and an abstract `MarkerOperations` interface — not on `mongodb`'s `Db` type. Concrete implementations stay in the adapter, which builds them behind the family's `MongoControlAdapter` SPI; the target reaches them through the family instance.

This gives the runner a clean package-layer position. It lives in the target package (`@internal/target-mongo`), which sits above the family-layer AST types but below the adapter. A target-layer module must not import adapter or driver code. The visitor SPIs make this possible: they are defined in the family layer (`@internal/mongo-query-ast`), the runner depends on them, and the adapter provides implementations.

### DDL execution

DDL commands — `CreateIndexCommand`, `DropIndexCommand`, `CreateCollectionCommand`, etc. — are frozen AST nodes with `accept(visitor)` dispatch ([ADR 188](ADR%20188%20-%20MongoDB%20migration%20operation%20model.md)). The runner calls `step.command.accept(commandExecutor)` for each execute step. The concrete `MongoCommandExecutor` in the adapter receives the typed command and calls the corresponding `mongodb` driver method. The runner never knows what `createIndex` actually does at the driver level.

Inspection commands (`ListIndexesCommand`, `ListCollectionsCommand`) follow the same pattern. The runner calls `check.source.accept(inspectionExecutor)` and gets back `Record<string, unknown>[]`. The concrete `MongoInspectionExecutor` calls `db.collection(...).listIndexes().toArray()` or `db.listCollections().toArray()`.

### DML execution

Data-transform operations (backfills, field renames, etc.) do not go through the DDL visitor. They use the same adapter + driver transport that runtime queries use: the runner calls `adapter.lower(plan)` to get a wire command, then `driver.execute(wireCommand)` to run it. This is the standard query-execution path — no bespoke executor needed.

An earlier design had a separate `MongoDmlExecutor` class that called `db.collection(...)` directly for data transforms. That class duplicated the command-dispatch logic already in the adapter and driver, and it added another `Db` dependency to the runner's interface. It was deleted. Both DDL and DML now flow through existing abstractions.

### MarkerOperations

The runner needs to read, initialize, and CAS-update the migration marker, and append ledger entries ([ADR 190](ADR%20190%20-%20CAS-based%20concurrency%20and%20migration%20state%20storage%20for%20MongoDB.md)). These four operations are abstracted behind a `MarkerOperations` interface:

```ts
export interface MarkerOperations {
  readMarker(): Promise<ContractMarkerRecord | null>;
  initMarker(destination: {
    readonly storageHash: string;
    readonly profileHash: string;
  }): Promise<void>;
  updateMarker(
    expectedFrom: string,
    destination: { readonly storageHash: string; readonly profileHash: string },
  ): Promise<boolean>;
  writeLedgerEntry(entry: {
    readonly edgeId: string;
    readonly from: string;
    readonly to: string;
  }): Promise<void>;
}
```

The concrete implementation calls into the migration marker collection per [ADR 190](ADR%20190%20-%20CAS-based%20concurrency%20and%20migration%20state%20storage%20for%20MongoDB.md) — but the runner interacts only with the interface. This was the last remaining `Db` dependency in the runner; extracting it completed the decoupling.

### Composition site

The target descriptor's `mongoTargetDescriptor.migrations.createRunner(family)` is where the runner is assembled, but it holds no concrete types. On the first `execute()` it calls `family.createRunnerDependencies({ driver })`. The family instance resolves the `MongoControlAdapter` from the control stack and delegates to `createRunnerDependencies(driver)`, which the adapter implements with its executors and the control driver's `Db` handle. The target caches the resulting `MongoRunnerDependencies` for the driver and passes it to a fresh `MongoMigrationRunner` for each contract space it applies.

## Consequences

- **Testability.** The runner can be unit-tested with mock visitors and no `mongodb` dependency. Tests supply in-memory implementations of `MarkerOperations` and stub visitors that record dispatched commands.
- **Extensibility.** Adding a new DDL command kind means one new visitor method in the adapter's `MongoCommandExecutor` — not a runner change. The runner's three-phase loop ([ADR 191](ADR%20191%20-%20Generic%20three-phase%20migration%20operation%20envelope.md)) is generic over the commands inside the envelope.
- **Layering.** The runner has no import from `mongodb`. It lives cleanly in the target layer, and `pnpm lint:deps` enforces the boundary.

## Alternatives considered

### Runner takes `Db` directly

The simplest option: pass `Db` to the runner's constructor and let it instantiate executors internally. This was the original design. We moved away from it because:

- It places the runner in the adapter layer (or forces the target layer to depend on `mongodb`), violating the package layering rules.
- It makes the runner untestable without a live MongoDB instance.
- It couples the runner to a specific driver version — swapping driver implementations (e.g., for Atlas serverless) would require modifying the runner.

### Adapter-level indirection without visitors

Instead of visitor dispatch, the runner could call a single `executeCommand(command: AnyMongoDdlCommand): Promise<void>` function. This works for DDL execution but loses the exhaustiveness guarantee: adding a new command kind to the union type wouldn't produce a compile error at the executor. The visitor interface forces every command kind to be handled — the same pattern used throughout the Mongo AST layer.

### Marker operations as a separate service

Rather than injecting `MarkerOperations` alongside the command visitors, the marker could be managed by a separate framework-level service that the runner calls indirectly. We chose direct injection because the marker is tightly coupled to the runner's execution loop — reading it before operations, CAS-updating it after. An extra layer of indirection would add complexity without enabling any meaningful reuse.
