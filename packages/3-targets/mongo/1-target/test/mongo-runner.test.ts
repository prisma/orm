import type {
  MarkerOperations,
  MongoRunnerDependencies,
} from '@internal/family-mongo/control-adapter';
import type { CodecCallContext } from '@internal/framework-components/codec';
import type {
  MigrationOperationPolicy,
  MigrationPlan,
  MigrationRunnerExecutionChecks,
  MigrationRunnerFailure,
} from '@internal/framework-components/control';
import {
  type AggregateMigrationEdgeRef,
  buildFabricatedMigrationEdge,
} from '@internal/migration-tools/aggregate';
import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import type { MongoContract } from '@internal/mongo-contract';
import type {
  MongoAdapter,
  MongoDdlPlan,
  MongoLoweredDraft,
  MongoQueryable,
} from '@internal/mongo-lowering';
import type {
  AnyMongoInspectionCommand,
  AnyMongoMigrationOperation,
  MongoInspectionCommandVisitor,
} from '@internal/mongo-query-ast/control';
import {
  AggregateCommand,
  MongoFieldFilter,
  MongoLimitStage,
  MongoMatchStage,
  type MongoQueryPlan,
  RawUpdateManyCommand,
} from '@internal/mongo-query-ast/execution';
import { MongoSchemaCollection, MongoSchemaIR } from '@internal/mongo-schema-ir';
import type {
  AnyMongoDdlWireCommand,
  AnyMongoDmlWireCommand,
  AnyMongoWireCommand,
} from '@internal/mongo-wire';
import { isStructuredError } from '@internal/utils/structured-error';
import { MongoServerError } from 'mongodb';
import { describe, expect, it } from 'vitest';
import {
  createCollection,
  createIndex,
  dataTransform,
  renameCollection,
  renameField,
  unsetField,
} from '../src/core/migrations/migration-factories';
import { serializeMongoOps } from '../src/core/migrations/mongo-ops-serializer';
import { MongoMigrationRunner } from '../src/core/migrations/mongo-runner';

type Row = Record<string, unknown>;
type WireCommand = AnyMongoWireCommand;

const ALL_POLICY: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'],
};

const NOOP_MARKER_OPS: MarkerOperations = {
  readMarker: async () => null,
  initMarker: async () => {},
  updateMarker: async () => true,
  writeLedgerEntry: async () => {},
};

class EventLog {
  readonly entries: string[] = [];
  record(entry: string): void {
    this.entries.push(entry);
  }
}

class StubMongoDriver implements MongoQueryable {
  readonly executeCalls: WireCommand[] = [];
  private readonly responses: Row[][] = [];
  private failure: unknown;

  constructor(private readonly log?: EventLog) {}

  failUpdateManyWith(error: unknown): void {
    this.failure = error;
  }

  queueResponse(rows: Row[]): void {
    this.responses.push(rows);
  }

  execute<R>(wireCommand: WireCommand): AsyncIterable<R> {
    this.executeCalls.push(wireCommand);
    this.log?.record(`dml:${wireCommand.kind}:${wireCommand.collection}`);
    const failure = wireCommand.kind === 'updateMany' ? this.failure : undefined;
    const rows = failure === undefined ? (this.responses.shift() ?? []) : [];
    return (async function* () {
      if (failure !== undefined) throw failure;
      for (const row of rows) yield row as R;
    })();
  }

  async run(_wireCommand: WireCommand): Promise<void> {}

  async close(): Promise<void> {}
}

type DmlWireCommand = AnyMongoDmlWireCommand;

class StubMongoAdapter implements MongoAdapter {
  readonly loweredPlans: MongoQueryPlan[] = [];

  structuralLower(plan: MongoQueryPlan): MongoLoweredDraft {
    this.loweredPlans.push(plan);
    const kind = plan.command.kind;
    if (kind === 'aggregate' || kind === 'rawAggregate') {
      return { kind: 'aggregate', collection: plan.collection, pipeline: [] };
    }
    return {
      kind: 'updateMany',
      collection: plan.collection,
      filter: {},
      update: {},
      upsert: undefined,
    };
  }

  async resolveParams(draft: MongoLoweredDraft, _ctx: CodecCallContext): Promise<DmlWireCommand> {
    const wireKind =
      draft.kind === 'aggregate' || draft.kind === 'rawAggregate' ? 'aggregate' : 'updateMany';
    return { kind: wireKind, collection: draft.collection } as unknown as DmlWireCommand;
  }

  lower(plan: MongoDdlPlan, ctx: CodecCallContext): Promise<AnyMongoDdlWireCommand>;
  lower(plan: MongoQueryPlan, ctx: CodecCallContext): Promise<AnyMongoDmlWireCommand>;
  lower(plan: MongoQueryPlan | MongoDdlPlan, ctx: CodecCallContext): Promise<WireCommand> {
    if ('collection' in plan) {
      return this.resolveParams(this.structuralLower(plan), ctx);
    }
    const { command } = plan;
    return Promise.resolve({
      kind: command.kind,
      collection: command.collection,
    } as unknown as WireCommand);
  }
}

class StubInspectionExecutor implements MongoInspectionCommandVisitor<Promise<Row[]>> {
  readonly calls: AnyMongoInspectionCommand[] = [];
  collections: Row[] = [];
  indexes: Row[] = [];

  async listIndexes(command: AnyMongoInspectionCommand): Promise<Row[]> {
    this.calls.push(command);
    return this.indexes;
  }
  async listCollections(command: AnyMongoInspectionCommand): Promise<Row[]> {
    this.calls.push(command);
    return this.collections;
  }
}

const RUN_COLLECTION = 'users';
const PLAN_META = {
  target: 'mongo' as const,
  storageHash: 'test',
  lane: 'mongo-raw',
};

function makeCheckPlan(): MongoQueryPlan {
  return {
    collection: RUN_COLLECTION,
    command: new AggregateCommand(RUN_COLLECTION, [
      new MongoMatchStage(MongoFieldFilter.eq('status', null)),
      new MongoLimitStage(1),
    ]),
    meta: { ...PLAN_META, lane: 'mongo-pipeline' },
  };
}

function makeWriteCheckPlan(): MongoQueryPlan {
  return {
    collection: RUN_COLLECTION,
    command: new RawUpdateManyCommand(
      RUN_COLLECTION,
      { status: { $exists: false } },
      { $set: { status: 'active' } },
    ),
    meta: PLAN_META,
  };
}

function makeRunPlan(): MongoQueryPlan {
  return {
    collection: RUN_COLLECTION,
    command: new RawUpdateManyCommand(
      RUN_COLLECTION,
      { status: { $exists: false } },
      { $set: { status: 'active' } },
    ),
    meta: PLAN_META,
  };
}

function serializedOperations(ops: readonly AnyMongoMigrationOperation[]): readonly unknown[] {
  return JSON.parse(serializeMongoOps(ops)) as readonly unknown[];
}

function makePlan(ops: readonly AnyMongoMigrationOperation[]): MigrationPlan {
  return {
    targetId: 'mongo',
    destination: { storageHash: 'dest' },
    // The runner's deserializer re-hydrates class instances from the JSON form,
    // so callers always hand it a pre-serialized operations list.
    operations: serializedOperations(ops) as unknown as MigrationPlan['operations'],
  };
}

function synthEdges(plan: MigrationPlan): readonly AggregateMigrationEdgeRef[] {
  return [
    buildFabricatedMigrationEdge({
      currentMarkerStorageHash: plan.origin?.storageHash,
      destinationStorageHash: plan.destination.storageHash,
      operationCount: plan.operations.length,
    }),
  ];
}

interface Harness {
  readonly runner: MongoMigrationRunner;
  readonly driver: StubMongoDriver;
  readonly adapter: StubMongoAdapter;
  readonly inspectionExecutor: StubInspectionExecutor;
  readonly log: EventLog;
  readonly ddlCalls: string[];
}

function makeHarness(): Harness {
  const log = new EventLog();
  const driver = new StubMongoDriver(log);
  const adapter = new StubMongoAdapter();
  const inspectionExecutor = new StubInspectionExecutor();
  const ddlCalls: string[] = [];
  const deps: MongoRunnerDependencies = {
    inspectionExecutor,
    adapter,
    driver,
    executeDdl: async (command) => {
      ddlCalls.push(`ddl:${command.kind}:${command.collection}`);
      log.record(`ddl:${command.kind}:${command.collection}`);
    },
    markerOps: NOOP_MARKER_OPS,
    introspectSchema: async () => new MongoSchemaIR([]),
  };
  return {
    runner: new MongoMigrationRunner(deps),
    driver,
    adapter,
    inspectionExecutor,
    log,
    ddlCalls,
  };
}

function makeContract(profileHash: string): MongoContract {
  // The runner reads `profileHash` for marker writes and `storage` (via
  // `verifyMongoSchema → contractToMongoSchemaIR`) for post-apply
  // verification. Empty `collections` paired with the harness's empty
  // `introspectSchema` stub produces a passing verify.
  return {
    profileHash,
    storage: {
      storageHash: 'dest',
      namespaces: {
        __unbound__: {
          id: '__unbound__',
          kind: 'mongo-namespace',
          entries: { collection: {} },
        },
      },
    },
  } as unknown as MongoContract;
}

function failureFields(failure: MigrationRunnerFailure) {
  return {
    code: failure.code,
    message: failure.message,
    ...(failure.why === undefined ? {} : { why: failure.why }),
    meta: failure.meta,
  };
}

async function execute(
  harness: Harness,
  ops: readonly AnyMongoMigrationOperation[],
  executionChecks?: MigrationRunnerExecutionChecks,
) {
  const plan = makePlan(ops);
  return harness.runner.execute({
    plan,
    migrationEdges: synthEdges(plan),
    destinationContract: makeContract('dest'),
    policy: ALL_POLICY,
    frameworkComponents: [],
    ...(executionChecks ? { executionChecks } : {}),
  });
}

describe('MongoMigrationRunner.executeDmlOperation', () => {
  it('runs the DML wire command once when there are no checks to gate it', async () => {
    const harness = makeHarness();
    const op = dataTransform('backfill-status', { run: () => makeRunPlan() });

    const result = await execute(harness, [op]);

    expect(result.assertOk()).toEqual({
      operationsPlanned: 1,
      operationsExecuted: 1,
      changedDatabase: true,
    });
    expect(harness.driver.executeCalls).toEqual([
      { kind: 'updateMany', collection: RUN_COLLECTION },
    ]);
    expect(harness.adapter.loweredPlans).toHaveLength(1);
    expect(harness.adapter.loweredPlans[0]?.command.kind).toBe('rawUpdateMany');
  });

  it('skips run when the postcheck probe reports the transform is already satisfied', async () => {
    const harness = makeHarness();
    const op = dataTransform('backfill-status', {
      check: { source: () => makeCheckPlan() },
      run: () => makeRunPlan(),
    });
    // Postcheck defaults to `expect: 'notExists'` — returning zero rows means
    // the transform is already satisfied, so the runner short-circuits.
    harness.driver.queueResponse([]);

    const result = await execute(harness, [op]);

    expect(result.assertOk()).toEqual({
      operationsPlanned: 1,
      operationsExecuted: 0,
      changedDatabase: true,
    });
    expect(harness.driver.executeCalls).toEqual([
      { kind: 'aggregate', collection: RUN_COLLECTION },
    ]);
  });

  it('fails with PRECHECK_FAILED and does not run the transform when the precheck is violated', async () => {
    const harness = makeHarness();
    const op = dataTransform('backfill-status', {
      check: { source: () => makeCheckPlan() },
      run: () => makeRunPlan(),
    });
    // Precheck expects `exists`; an empty response from the probe means the
    // required precondition is not met.
    harness.driver.queueResponse([]);

    const result = await execute(harness, [op], { idempotencyChecks: false });

    expect(failureFields(result.assertNotOk())).toEqual({
      code: 'MIGRATION.PRECHECK_FAILED',
      message: `Operation ${op.id} failed during precheck`,
      why: 'The failed apply changed nothing.',
      meta: { operationId: op.id, name: op.name, databaseUnchanged: true },
    });
    expect(harness.driver.executeCalls).toEqual([
      { kind: 'aggregate', collection: RUN_COLLECTION },
    ]);
  });

  it('fails with POSTCHECK_FAILED after the run when the postcheck is violated', async () => {
    const harness = makeHarness();
    const op = dataTransform('backfill-status', {
      check: { source: () => makeCheckPlan() },
      run: () => makeRunPlan(),
    });
    // 1) precheck probe (expect: 'exists') — rows present → passes.
    harness.driver.queueResponse([{ _id: 'u1' }]);
    // 2) run — consumes the driver but we don't yield rows.
    harness.driver.queueResponse([]);
    // 3) postcheck probe (expect: 'notExists') — rows present → fails.
    harness.driver.queueResponse([{ _id: 'u1' }]);

    const result = await execute(harness, [op], { idempotencyChecks: false });

    expect(failureFields(result.assertNotOk())).toEqual({
      code: 'MIGRATION.POSTCHECK_FAILED',
      message: `Operation ${op.id} failed during postcheck`,
      why: 'The operations that ran before the failure stay applied.',
      meta: { operationId: op.id, name: op.name, databaseUnchanged: false },
    });
    expect(harness.driver.executeCalls.map((c) => c.kind)).toEqual([
      'aggregate',
      'updateMany',
      'aggregate',
    ]);
  });

  it.each([
    ['changed no document', { matchedCount: 0, modifiedCount: 0 }, true],
    ['changed a document', { matchedCount: 1, modifiedCount: 1 }, false],
  ])(
    'says whether the database changed when a run that %s fails its postcheck',
    async (_, runResult, databaseUnchanged) => {
      const harness = makeHarness();
      const op = dataTransform('backfill-status', {
        check: { source: () => makeCheckPlan() },
        run: () => makeRunPlan(),
      });
      harness.driver.queueResponse([{ _id: 'u1' }]);
      harness.driver.queueResponse([runResult]);
      harness.driver.queueResponse([{ _id: 'u1' }]);

      const result = await execute(harness, [op], { idempotencyChecks: false });

      expect(failureFields(result.assertNotOk())).toMatchObject({
        code: 'MIGRATION.POSTCHECK_FAILED',
        meta: { databaseUnchanged },
      });
    },
  );

  it('rejects a check whose source is not an aggregate command before invoking driver.execute', async () => {
    const harness = makeHarness();
    const op = dataTransform('backfill-status', {
      check: { source: () => makeWriteCheckPlan() },
      run: () => makeRunPlan(),
    });

    let thrown: unknown;
    try {
      await execute(harness, [op], { idempotencyChecks: false });
    } catch (error) {
      thrown = error;
    }

    expect(isStructuredError(thrown)).toBe(true);
    expect(thrown).toMatchObject({
      code: 'MIGRATION.DATA_TRANSFORM_CHECK_NOT_READ_ONLY',
      meta: {
        commandKind: 'rawUpdateMany',
        collection: RUN_COLLECTION,
      },
    });
    expect((thrown as Error).message).toContain('rawUpdateMany');
    expect(harness.driver.executeCalls).toEqual([]);
  });

  it('dispatches DDL ops through executeDdl seam and data ops through adapter.lower + driver.execute, in plan order', async () => {
    const harness = makeHarness();
    const ddlOp = createCollection('orders');
    const dataOp = dataTransform('seed-orders', { run: () => makeRunPlan() });

    const result = await execute(harness, [ddlOp, dataOp], {
      prechecks: false,
      postchecks: false,
      idempotencyChecks: false,
    });

    expect(result.assertOk()).toEqual({
      operationsPlanned: 2,
      operationsExecuted: 2,
      changedDatabase: true,
    });
    expect(harness.ddlCalls).toEqual(['ddl:createCollection:orders']);
    expect(harness.driver.executeCalls).toHaveLength(1);
    expect(harness.driver.executeCalls[0]).toMatchObject({
      kind: 'updateMany',
      collection: RUN_COLLECTION,
    });
    expect(harness.log.entries).toEqual([
      'ddl:createCollection:orders',
      `dml:updateMany:${RUN_COLLECTION}`,
    ]);
  });
});

describe('MongoMigrationRunner schema verification', () => {
  interface MarkerCallLog {
    readonly initMarker: number;
    readonly updateMarker: number;
    readonly writeLedgerEntry: number;
  }

  function makeTrackingMarkerOps(): { ops: MarkerOperations; calls: MarkerCallLog } {
    const calls = { initMarker: 0, updateMarker: 0, writeLedgerEntry: 0 };
    const ops: MarkerOperations = {
      readMarker: async () => null,
      initMarker: async () => {
        calls.initMarker++;
      },
      updateMarker: async () => {
        calls.updateMarker++;
        return true;
      },
      writeLedgerEntry: async () => {
        calls.writeLedgerEntry++;
      },
    };
    return { ops, calls };
  }

  function makeHarnessWithDrift(): {
    runner: MongoMigrationRunner;
    calls: MarkerCallLog;
  } {
    const { ops, calls } = makeTrackingMarkerOps();
    const driver = new StubMongoDriver();
    const adapter = new StubMongoAdapter();
    const inspectionExecutor = new StubInspectionExecutor();
    const driftIR = new MongoSchemaIR([new MongoSchemaCollection({ name: 'rogue' })]);
    const deps: MongoRunnerDependencies = {
      inspectionExecutor,
      adapter,
      driver,
      executeDdl: async () => {},
      markerOps: ops,
      introspectSchema: async () => driftIR,
    };
    return { runner: new MongoMigrationRunner(deps), calls };
  }

  it('returns SCHEMA_VERIFY_FAILED with issues when live schema diverges from contract', async () => {
    const { runner, calls } = makeHarnessWithDrift();
    const ddlOp = createCollection('orders');

    const driftPlan = makePlan([ddlOp]);
    const result = await runner.execute({
      plan: driftPlan,
      migrationEdges: synthEdges(driftPlan),
      destinationContract: makeContract('dest'),
      policy: ALL_POLICY,
      frameworkComponents: [],
      executionChecks: { prechecks: false, postchecks: false, idempotencyChecks: false },
    });

    const failure = result.assertNotOk();
    expect(failure.code).toBe('MIGRATION.SCHEMA_VERIFY_FAILED');
    expect(failure.why).toBe(
      'The schema check after apply found: extra: rogue. The operations that ran before the failure stay applied.',
    );
    expect(failure.meta).toEqual({
      databaseUnchanged: false,
      schemaIssues: expect.arrayContaining([expect.objectContaining({ path: ['rogue'] })]),
    });
    expect(calls).toEqual({ initMarker: 0, updateMarker: 0, writeLedgerEntry: 0 });
  });

  it('skips verification when the no-op short-circuit fires (no operations + marker matches destination)', async () => {
    const { ops, calls } = makeTrackingMarkerOps();
    const trackingReadMarker: MarkerOperations = {
      ...ops,
      readMarker: async () => ({
        storageHash: 'dest',
        profileHash: 'dest',
        contractJson: null,
        canonicalVersion: null,
        updatedAt: new Date(),
        appTag: null,
        meta: {},
        invariants: [],
      }),
    };
    let introspectCalls = 0;
    const driver = new StubMongoDriver();
    const adapter = new StubMongoAdapter();
    const inspectionExecutor = new StubInspectionExecutor();
    const driftIR = new MongoSchemaIR([new MongoSchemaCollection({ name: 'rogue' })]);
    const deps: MongoRunnerDependencies = {
      inspectionExecutor,
      adapter,
      driver,
      executeDdl: async () => {},
      markerOps: trackingReadMarker,
      introspectSchema: async () => {
        introspectCalls++;
        return driftIR;
      },
    };

    const runner = new MongoMigrationRunner(deps);
    const noOpPlan: MigrationPlan = {
      targetId: 'mongo',
      origin: { storageHash: 'dest' },
      destination: { storageHash: 'dest' },
      operations: [] as unknown as MigrationPlan['operations'],
    };
    const result = await runner.execute({
      plan: noOpPlan,
      migrationEdges: synthEdges(noOpPlan),
      destinationContract: makeContract('dest'),
      policy: ALL_POLICY,
      frameworkComponents: [],
    });

    expect(result.assertOk()).toEqual({
      operationsPlanned: 0,
      operationsExecuted: 0,
      changedDatabase: false,
    });
    expect(introspectCalls).toBe(0);
    expect(calls).toEqual({ initMarker: 0, updateMarker: 0, writeLedgerEntry: 0 });
  });

  it('treats out-of-band collections as warnings under strictVerification: false', async () => {
    const { runner, calls } = makeHarnessWithDrift();
    const ddlOp = createCollection('orders');

    const warnPlan = makePlan([ddlOp]);
    const result = await runner.execute({
      plan: warnPlan,
      migrationEdges: synthEdges(warnPlan),
      destinationContract: makeContract('dest'),
      policy: ALL_POLICY,
      frameworkComponents: [],
      strictVerification: false,
      executionChecks: { prechecks: false, postchecks: false, idempotencyChecks: false },
    });

    expect(result.assertOk()).toEqual({
      operationsPlanned: 1,
      operationsExecuted: 1,
      changedDatabase: true,
    });
    expect(calls.initMarker).toBe(1);
    expect(calls.writeLedgerEntry).toBe(1);
  });
});

const LEDGER_TEST_SPACE_ID = 'ledger-test';

type LedgerEntryPayload = Parameters<MarkerOperations['writeLedgerEntry']>[1];

function makeLedgerHarness(): {
  runner: MongoMigrationRunner;
  ledgerEntries: LedgerEntryPayload[];
} {
  const ledgerEntries: LedgerEntryPayload[] = [];
  const markerOps: MarkerOperations = {
    readMarker: async () => null,
    initMarker: async () => {},
    updateMarker: async () => true,
    writeLedgerEntry: async (_space, entry) => {
      ledgerEntries.push(entry);
    },
  };
  const deps: MongoRunnerDependencies = {
    inspectionExecutor: new StubInspectionExecutor(),
    adapter: new StubMongoAdapter(),
    driver: new StubMongoDriver(),
    executeDdl: async () => {},
    markerOps,
    introspectSchema: async () => new MongoSchemaIR([]),
  };
  return { runner: new MongoMigrationRunner(deps), ledgerEntries };
}

function makeLedgerPlan(
  ops: readonly AnyMongoMigrationOperation[],
  options: {
    readonly destinationHash?: string;
    readonly migrationEdges?: readonly AggregateMigrationEdgeRef[];
  } = {},
): MigrationPlan {
  return {
    targetId: 'mongo',
    spaceId: LEDGER_TEST_SPACE_ID,
    origin: null,
    destination: { storageHash: options.destinationHash ?? 'dest' },
    operations: serializedOperations(ops) as unknown as MigrationPlan['operations'],
  };
}

const LEDGER_EXECUTION_CHECKS: MigrationRunnerExecutionChecks = {
  prechecks: false,
  postchecks: false,
  idempotencyChecks: false,
};

describe('MongoMigrationRunner - per-edge ledger', () => {
  it('writes one ledger entry for a single-edge apply with space, name, hash, from/to, and that edge ops', async () => {
    const { runner, ledgerEntries } = makeLedgerHarness();
    const destHash = 'dest';
    const edges: readonly AggregateMigrationEdgeRef[] = [
      {
        migrationHash: 'mig-single',
        dirName: '001_single',
        from: EMPTY_CONTRACT_HASH,
        to: destHash,
        operationCount: 1,
      },
    ];
    const planOps = serializedOperations([createCollection('ledger_single')]);
    const result = await runner.execute({
      plan: makeLedgerPlan([createCollection('ledger_single')], { destinationHash: destHash }),
      destinationContract: makeContract(destHash),
      policy: ALL_POLICY,
      frameworkComponents: [],
      strictVerification: false,
      executionChecks: LEDGER_EXECUTION_CHECKS,
      migrationEdges: edges,
    });

    expect(result.assertOk()).toEqual({
      operationsPlanned: 1,
      operationsExecuted: 1,
      changedDatabase: true,
    });
    expect(ledgerEntries).toHaveLength(1);
    expect(ledgerEntries[0]).toMatchObject({
      edgeId: `${EMPTY_CONTRACT_HASH}->${destHash}`,
      from: EMPTY_CONTRACT_HASH,
      to: destHash,
      migrationName: '001_single',
      migrationHash: 'mig-single',
    });
    const storedOps = ledgerEntries[0]?.operations as Array<{ id: string }>;
    expect(storedOps).toHaveLength(1);
    expect(storedOps[0]?.id).toBe((planOps[0] as { id: string }).id);
  });

  it('writes N ledger entries in walk order for multi-edge apply with ops attributed per edge', async () => {
    const { runner, ledgerEntries } = makeLedgerHarness();
    const hashA = 'ledger-mid-a';
    const hashB = 'ledger-mid-b';
    const destHash = 'dest';
    const edges: readonly AggregateMigrationEdgeRef[] = [
      {
        migrationHash: 'mig-a',
        dirName: '001_a',
        from: EMPTY_CONTRACT_HASH,
        to: hashA,
        operationCount: 1,
      },
      {
        migrationHash: 'mig-b',
        dirName: '002_b',
        from: hashA,
        to: hashB,
        operationCount: 2,
      },
      {
        migrationHash: 'mig-c',
        dirName: '003_c',
        from: hashB,
        to: destHash,
        operationCount: 1,
      },
    ];
    const ops = [
      createCollection('ledger_a'),
      createCollection('ledger_b1'),
      createCollection('ledger_b2'),
      createCollection('ledger_c'),
    ];
    const planOps = serializedOperations(ops) as Array<{ id: string }>;

    const result = await runner.execute({
      plan: makeLedgerPlan(ops, { destinationHash: destHash }),
      destinationContract: makeContract(destHash),
      policy: ALL_POLICY,
      frameworkComponents: [],
      strictVerification: false,
      executionChecks: LEDGER_EXECUTION_CHECKS,
      migrationEdges: edges,
    });

    expect(result.assertOk()).toEqual({
      operationsPlanned: 4,
      operationsExecuted: 4,
      changedDatabase: true,
    });
    expect(ledgerEntries).toHaveLength(3);
    expect(ledgerEntries.map((e) => e.migrationName)).toEqual(['001_a', '002_b', '003_c']);
    expect(ledgerEntries[0]).toMatchObject({
      edgeId: `${EMPTY_CONTRACT_HASH}->${hashA}`,
      from: EMPTY_CONTRACT_HASH,
      to: hashA,
      migrationHash: 'mig-a',
    });
    expect(ledgerEntries[1]).toMatchObject({
      edgeId: `${hashA}->${hashB}`,
      from: hashA,
      to: hashB,
      migrationHash: 'mig-b',
    });
    expect(ledgerEntries[2]).toMatchObject({
      edgeId: `${hashB}->${destHash}`,
      from: hashB,
      to: destHash,
      migrationHash: 'mig-c',
    });

    const opCounts = ledgerEntries.map((e) => (e.operations as unknown[]).length);
    expect(opCounts).toEqual([1, 2, 1]);
    const opIds = ledgerEntries.flatMap((e) =>
      (e.operations as Array<{ id: string }>).map((o) => o.id),
    );
    expect(opIds).toEqual(planOps.map((o) => o.id));
  });

  it('throws when migrationEdges operationCount sum does not match plan.operations length', async () => {
    const { runner } = makeLedgerHarness();
    const destHash = 'dest';
    const edges: readonly AggregateMigrationEdgeRef[] = [
      {
        migrationHash: 'mig-single',
        dirName: '001_single',
        from: EMPTY_CONTRACT_HASH,
        to: destHash,
        operationCount: 2,
      },
    ];

    await expect(
      runner.execute({
        plan: makeLedgerPlan([createCollection('ledger_single')], { destinationHash: destHash }),
        destinationContract: makeContract(destHash),
        policy: ALL_POLICY,
        frameworkComponents: [],
        strictVerification: false,
        executionChecks: LEDGER_EXECUTION_CHECKS,
        migrationEdges: edges,
      }),
    ).rejects.toThrow(/does not match sum of migrationEdges operationCount/);
  });

  it('writes one synthesised ledger entry with empty migration name for synth apply with a single synth edge', async () => {
    const { runner, ledgerEntries } = makeLedgerHarness();
    const destHash = 'dest';
    const plan = makeLedgerPlan([createCollection('ledger_synth')], { destinationHash: destHash });
    const synthEdges: readonly AggregateMigrationEdgeRef[] = [
      {
        dirName: '',
        migrationHash: destHash,
        from: '',
        to: destHash,
        operationCount: plan.operations.length,
      },
    ];

    const result = await runner.execute({
      plan,
      destinationContract: makeContract(destHash),
      policy: ALL_POLICY,
      frameworkComponents: [],
      strictVerification: false,
      executionChecks: LEDGER_EXECUTION_CHECKS,
      migrationEdges: synthEdges,
    });

    expect(result.assertOk()).toEqual({
      operationsPlanned: 1,
      operationsExecuted: 1,
      changedDatabase: true,
    });
    expect(ledgerEntries).toHaveLength(1);
    expect(ledgerEntries[0]).toMatchObject({
      edgeId: `->${destHash}`,
      from: '',
      to: destHash,
      migrationName: '',
      migrationHash: destHash,
    });
    expect((ledgerEntries[0]!.operations as unknown[]).length).toBe(1);
  });
});

const COMMAND_ECHO =
  'not authorized on app to execute command { update: "users", ordered: true, bypassDocumentValidation: true, lsid: { id: UUID("0b2c8a4e-6f0d-4a7e-9d6f-2f1d5c3e8a91") }, txnNumber: 1, $clusterTime: { clusterTime: Timestamp(1791552000, 3), signature: { hash: BinData(0, 7F3C1D9E2A4B6C8D0E1F2A3B4C5D6E7F8A9B0C1D), keyId: 7421987654321098753 } }, $db: "app" }';

describe('MongoMigrationRunner, a document rewrite without the privilege to skip validation', () => {
  const unauthorized = () =>
    new MongoServerError({
      ok: 0,
      code: 13,
      codeName: 'Unauthorized',
      errmsg: COMMAND_ECHO,
    });

  it('names the bypassDocumentValidation action and the roles that grant it', async () => {
    const harness = makeHarness();
    harness.driver.queueResponse([{ _id: 1 }]);
    harness.driver.failUpdateManyWith(unauthorized());

    const result = await execute(harness, [unsetField('users', 'nickname')]);

    expect(JSON.stringify(result.assertNotOk())).not.toContain('clusterTime');
    expect(failureFields(result.assertNotOk())).toEqual({
      code: 'MIGRATION.EXECUTION_FAILED',
      message:
        'Operation field.users.nickname.unset failed: the database user may not skip document validation',
      why: 'Renaming or removing a field rewrites documents with bypassDocumentValidation, because the old validator requires the old field. MongoDB refused it with error 13 (Unauthorized). Grant the user the bypassDocumentValidation action on the database, for example with the dbAdmin or restore role, then run the command again; operations that already ran are skipped. The failed apply changed nothing.',
      meta: {
        operationId: 'field.users.nickname.unset',
        mongoCode: 13,
        codeName: 'Unauthorized',
        databaseUnchanged: true,
      },
    });
  });

  it('lets any other failure of a data transform through unchanged', async () => {
    const harness = makeHarness();
    harness.driver.failUpdateManyWith(unauthorized());

    await expect(
      execute(harness, [dataTransform('backfill-status', { run: () => makeRunPlan() })]),
    ).rejects.toBeInstanceOf(MongoServerError);
  });
});

describe('MongoMigrationRunner, a field rename stopped because documents already hold the new name', () => {
  it('says which collection, how to find the documents, and that nothing changed when no operation ran before it', async () => {
    const harness = makeHarness();
    harness.driver.queueResponse([{ _id: 1 }]);
    harness.driver.queueResponse([{ _id: 2 }]);

    const result = await execute(harness, [
      renameField('posts', 'title', 'headline', { filter: { type: 'bug' } }),
    ]);

    expect(failureFields(result.assertNotOk())).toEqual({
      code: 'MIGRATION.PRECHECK_FAILED',
      message:
        'Operation field.posts.title.rename(headline).where({"type":"bug"}) stopped: some documents in collection posts already hold headline as well as title',
      why: 'Renaming title to headline would overwrite their headline. Find them with db.getCollection("posts").find({"$and":[{"type":"bug"},{"title":{"$exists":true}},{"headline":{"$exists":true}}]}) in mongosh, and move or remove one of the two values in each. Nothing was renamed. Once the documents are fixed, run the command again; operations that already ran are skipped. The failed apply changed nothing.',
      meta: {
        databaseUnchanged: true,
        operationId: 'field.posts.title.rename(headline).where({"type":"bug"})',
        name: 'field.posts.title.rename(headline).where({"type":"bug"})',
      },
    });
  });
});

describe('MongoMigrationRunner, a collection rename stopped because the new collection exists', () => {
  it('says that the new collection exists, names both collections, and that nothing was renamed', async () => {
    const harness = makeHarness();
    harness.inspectionExecutor.collections = [{ name: 'events' }, { name: 'occasions' }];

    const result = await execute(harness, [renameCollection('events', 'occasions')]);

    expect(harness.ddlCalls).toEqual([]);
    expect(failureFields(result.assertNotOk())).toEqual({
      code: 'MIGRATION.PRECHECK_FAILED',
      message:
        'Operation collection.events.rename(occasions) stopped: collection occasions already exists, so collection events cannot be renamed to it',
      why: 'Nothing was renamed. If occasions holds nothing you need, drop it, then run the command again; operations that already ran are skipped. If an earlier operation of the same migration created occasions, as a createIndex on occasions does, make renameCollection("events", "occasions") the first operation of its migration.ts, run node on that migration.ts, and then drop occasions and run the command again. The failed apply changed nothing.',
      meta: { operationId: 'collection.events.rename(occasions)', databaseUnchanged: true },
    });
  });
});

describe('MongoMigrationRunner, a DDL precheck that does not hold', () => {
  it('reports the failed check once, in meta.failedCheck', async () => {
    const harness = makeHarness();
    harness.inspectionExecutor.collections = [{ name: 'orders' }];

    const result = await execute(harness, [createCollection('orders')], {
      prechecks: true,
      postchecks: false,
      idempotencyChecks: false,
    });

    expect(failureFields(result.assertNotOk())).toEqual({
      code: 'MIGRATION.PRECHECK_FAILED',
      message:
        'Operation collection.orders.create failed during precheck: collection orders does not exist',
      why: 'Before operation collection.orders.create runs, it checks: collection orders does not exist. That check failed: the database already has collection "orders". The failed apply changed nothing.',
      meta: {
        databaseUnchanged: true,
        failedCheck: {
          operationId: 'collection.orders.create',
          phase: 'precheck',
          description: 'collection orders does not exist',
          expectation: { expects: 'absent', object: 'collection "orders"' },
        },
      },
    });
  });
});

describe('MongoMigrationRunner, a DDL postcheck that does not hold', () => {
  it('reports the failed check in meta.failedCheck, with what it expected', async () => {
    const harness = makeHarness();
    harness.inspectionExecutor.collections = [{ name: 'events' }];

    const result = await execute(harness, [renameCollection('events', 'occasions')], {
      prechecks: true,
      postchecks: true,
      idempotencyChecks: false,
    });

    expect(failureFields(result.assertNotOk())).toEqual({
      code: 'MIGRATION.POSTCHECK_FAILED',
      message:
        'Operation collection.events.rename(occasions) failed during postcheck: collection occasions exists',
      why: 'After operation collection.events.rename(occasions) ran, it checks: collection occasions exists. That check failed: the database has no collection "occasions". The operations that ran before the failure stay applied.',
      meta: {
        databaseUnchanged: false,
        operationId: 'collection.events.rename(occasions)',
        failedCheck: {
          operationId: 'collection.events.rename(occasions)',
          phase: 'postcheck',
          description: 'collection occasions exists',
          expectation: { expects: 'present', object: 'collection "occasions"' },
        },
      },
    });
  });
});

describe('MongoMigrationRunner, a failure after an earlier space changed the database', () => {
  it('says the operations that ran stay applied, though this space changed nothing', async () => {
    const harness = makeHarness();
    harness.inspectionExecutor.collections = [{ name: 'orders' }];
    const plan = makePlan([createCollection('orders')]);

    const result = await harness.runner.execute({
      plan,
      migrationEdges: synthEdges(plan),
      destinationContract: makeContract('dest'),
      policy: ALL_POLICY,
      frameworkComponents: [],
      executionChecks: { prechecks: true, postchecks: false, idempotencyChecks: false },
      databaseChangedBefore: true,
    });

    const failure = result.assertNotOk();
    expect({
      databaseUnchanged: failure.meta.databaseUnchanged,
      why: failure.why,
    }).toEqual({
      databaseUnchanged: false,
      why: 'Before operation collection.orders.create runs, it checks: collection orders does not exist. That check failed: the database already has collection "orders". The operations that ran before the failure stay applied.',
    });
  });
});

describe('MongoMigrationRunner, an index check that finds an index of the same keys', () => {
  it('names the keys it matched, not a name the check does not test', async () => {
    const harness = makeHarness();
    harness.inspectionExecutor.indexes = [{ name: 'by_email', key: { email: 1 } }];

    const result = await execute(
      harness,
      [createIndex('users', [{ field: 'email', direction: 1 }])],
      {
        prechecks: true,
        postchecks: false,
        idempotencyChecks: false,
      },
    );

    expect(result.assertNotOk().why).toBe(
      'Before operation index.users.create(email:1) runs, it checks: index does not already exist on users. That check failed: the database already has an index on { email: 1 } in "users". The failed apply changed nothing.',
    );
  });
});
