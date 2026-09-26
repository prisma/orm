import type {
  MarkerOperations,
  MongoRunnerDependencies,
} from '@internal/family-mongo/control-adapter';
import type { CodecCallContext } from '@internal/framework-components/codec';
import type {
  MigrationOperationPolicy,
  MigrationPlan,
  MigrationRunnerExecutionChecks,
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
  MongoDriver,
  MongoLoweredDraft,
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
import { describe, expect, it } from 'vitest';
import { createCollection, dataTransform } from '../src/core/migrations/migration-factories';
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

class StubMongoDriver implements MongoDriver {
  readonly executeCalls: WireCommand[] = [];
  private readonly responses: Row[][] = [];

  constructor(private readonly log?: EventLog) {}

  queueResponse(rows: Row[]): void {
    this.responses.push(rows);
  }

  execute<R>(wireCommand: WireCommand): AsyncIterable<R> {
    this.executeCalls.push(wireCommand);
    this.log?.record(`dml:${wireCommand.kind}:${wireCommand.collection}`);
    const rows = this.responses.shift() ?? [];
    return (async function* () {
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

  async listIndexes(command: AnyMongoInspectionCommand): Promise<Row[]> {
    this.calls.push(command);
    return [];
  }
  async listCollections(command: AnyMongoInspectionCommand): Promise<Row[]> {
    this.calls.push(command);
    return [];
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

describe('MongoMigrationRunner.executeDataTransform', () => {
  it('runs the DML wire command once when there are no checks to gate it', async () => {
    const harness = makeHarness();
    const op = dataTransform('backfill-status', { run: () => makeRunPlan() });

    const result = await execute(harness, [op]);

    expect(result.assertOk()).toEqual({ operationsPlanned: 1, operationsExecuted: 1 });
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

    expect(result.assertOk()).toEqual({ operationsPlanned: 1, operationsExecuted: 0 });
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

    expect(result.assertNotOk()).toMatchObject({
      code: 'MIGRATION.PRECHECK_FAILED',
      summary: `Operation ${op.id} failed during precheck`,
      meta: { operationId: op.id, name: op.name },
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

    expect(result.assertNotOk()).toMatchObject({
      code: 'MIGRATION.POSTCHECK_FAILED',
      summary: `Operation ${op.id} failed during postcheck`,
      meta: { operationId: op.id, name: op.name },
    });
    expect(harness.driver.executeCalls.map((c) => c.kind)).toEqual([
      'aggregate',
      'updateMany',
      'aggregate',
    ]);
  });

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

    expect(thrown).toMatchObject({
      code: 'MIGRATION.RUNNER_FAILED',
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

    expect(result.assertOk()).toEqual({ operationsPlanned: 2, operationsExecuted: 2 });
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
    expect(failure.why).toMatch(/destination contract/);
    expect(failure.meta?.['issues']).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: ['rogue'] })]),
    );
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

    expect(result.assertOk()).toEqual({ operationsPlanned: 0, operationsExecuted: 0 });
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

    expect(result.assertOk()).toEqual({ operationsPlanned: 1, operationsExecuted: 1 });
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

    expect(result.assertOk()).toEqual({ operationsPlanned: 1, operationsExecuted: 1 });
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

    expect(result.assertOk()).toEqual({ operationsPlanned: 4, operationsExecuted: 4 });
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

    expect(result.assertOk()).toEqual({ operationsPlanned: 1, operationsExecuted: 1 });
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
