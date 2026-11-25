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
import { MongoSchemaIR } from '@internal/mongo-schema-ir';
import type {
  AnyMongoDdlWireCommand,
  AnyMongoDmlWireCommand,
  AnyMongoWireCommand,
} from '@internal/mongo-wire';
import { serializeMongoOps } from '../src/core/migrations/mongo-ops-serializer';
import { MongoMigrationRunner } from '../src/core/migrations/mongo-runner';

export type Row = Record<string, unknown>;
export type WireCommand = AnyMongoWireCommand;

export const ALL_POLICY: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'],
};

export const NOOP_MARKER_OPS: MarkerOperations = {
  markerLocation: '_prisma_migrations',
  readMarker: async () => null,
  initMarker: async () => {},
  updateMarker: async () => true,
  writeLedgerEntry: async () => {},
};

export class EventLog {
  readonly entries: string[] = [];
  record(entry: string): void {
    this.entries.push(entry);
  }
}

export class StubMongoDriver implements MongoQueryable {
  readonly executeCalls: WireCommand[] = [];
  private readonly responses: Row[][] = [];
  private failure: { readonly kind: WireCommand['kind']; readonly error: unknown } | undefined;

  constructor(private readonly log?: EventLog) {}

  failUpdateManyWith(error: unknown): void {
    this.failure = { kind: 'updateMany', error };
  }

  failAggregateWith(error: unknown): void {
    this.failure = { kind: 'aggregate', error };
  }

  queueResponse(rows: Row[]): void {
    this.responses.push(rows);
  }

  execute<R>(wireCommand: WireCommand): AsyncIterable<R> {
    this.executeCalls.push(wireCommand);
    this.log?.record(`dml:${wireCommand.kind}:${wireCommand.collection}`);
    const failure = wireCommand.kind === this.failure?.kind ? this.failure.error : undefined;
    const rows = failure === undefined ? (this.responses.shift() ?? []) : [];
    return (async function* () {
      if (failure !== undefined) throw failure;
      for (const row of rows) yield row as R;
    })();
  }

  async run(_wireCommand: WireCommand): Promise<void> {}

  async close(): Promise<void> {}
}

export type DmlWireCommand = AnyMongoDmlWireCommand;

export class StubMongoAdapter implements MongoAdapter {
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

export class StubInspectionExecutor implements MongoInspectionCommandVisitor<Promise<Row[]>> {
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

export const RUN_COLLECTION = 'users';
export const PLAN_META = {
  target: 'mongo' as const,
  storageHash: 'test',
  lane: 'mongo-raw',
};

export function makeCheckPlan(): MongoQueryPlan {
  return {
    collection: RUN_COLLECTION,
    command: new AggregateCommand(RUN_COLLECTION, [
      new MongoMatchStage(MongoFieldFilter.eq('status', null)),
      new MongoLimitStage(1),
    ]),
    meta: { ...PLAN_META, lane: 'mongo-pipeline' },
  };
}

export function makeWriteCheckPlan(): MongoQueryPlan {
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

export function makeRunPlan(): MongoQueryPlan {
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

export function serializedOperations(
  ops: readonly AnyMongoMigrationOperation[],
): readonly unknown[] {
  return JSON.parse(serializeMongoOps(ops)) as readonly unknown[];
}

export function makePlan(ops: readonly AnyMongoMigrationOperation[]): MigrationPlan {
  return {
    targetId: 'mongo',
    destination: { storageHash: 'dest' },
    // The runner's deserializer re-hydrates class instances from the JSON form,
    // so callers always hand it a pre-serialized operations list.
    operations: serializedOperations(ops) as unknown as MigrationPlan['operations'],
  };
}

export function synthEdges(plan: MigrationPlan): readonly AggregateMigrationEdgeRef[] {
  return [
    buildFabricatedMigrationEdge({
      currentMarkerStorageHash: plan.origin?.storageHash,
      destinationStorageHash: plan.destination.storageHash,
      operationCount: plan.operations.length,
    }),
  ];
}

export interface Harness {
  readonly runner: MongoMigrationRunner;
  readonly driver: StubMongoDriver;
  readonly adapter: StubMongoAdapter;
  readonly inspectionExecutor: StubInspectionExecutor;
  readonly log: EventLog;
  readonly ddlCalls: string[];
}

export function makeHarness(options: { readonly ddlError?: unknown } = {}): Harness {
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
      if (options.ddlError !== undefined) throw options.ddlError;
    },
    markerOps: NOOP_MARKER_OPS,
    introspectSchema: async () => new MongoSchemaIR([], { fromDatabase: false }),
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

export function makeContract(profileHash: string): MongoContract {
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

export function failureFields(failure: MigrationRunnerFailure) {
  return {
    code: failure.code,
    message: failure.message,
    ...(failure.why === undefined ? {} : { why: failure.why }),
    meta: failure.meta,
  };
}

export async function execute(
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
