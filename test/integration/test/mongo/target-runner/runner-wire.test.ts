import mongoAdapterDescriptor, { MongoControlAdapterImpl } from '@internal/adapter-mongo/control';
import { MongoControlDriver } from '@internal/driver-mongo/control';
import { mongoFamilyDescriptor } from '@internal/family-mongo/control';
import {
  createControlStack,
  type MigrationPlan,
  type MigrationPlanOperation,
} from '@internal/framework-components/control';
import {
  type AggregateMigrationEdgeRef,
  buildFabricatedMigrationEdge,
} from '@internal/migration-tools/aggregate';
import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import type { MongoContract } from '@internal/mongo-contract';
import type { AnyMongoMigrationOperation } from '@internal/mongo-query-ast/control';
import { MongoSchemaCollection, MongoSchemaIndex, MongoSchemaIR } from '@internal/mongo-schema-ir';
import {
  MongoMigrationPlanner,
  MongoMigrationRunner,
  mongoTargetDescriptor,
  serializeMongoOps,
} from '@internal/target-mongo/control';
import { createCollection } from '@internal/target-mongo/migration';
import { timeouts } from '@repo/test-utils';
import { type Db, MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const controlAdapter = new MongoControlAdapterImpl();

let replSet: MongoMemoryReplSet;
let client: MongoClient;
let db: Db;
const dbName = 'runner_test';

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  client = new MongoClient(replSet.getUri());
  await client.connect();
  db = client.db(dbName);
}, timeouts.spinUpMongoMemoryServer);

afterAll(async () => {
  await client?.close();
  await replSet?.stop();
}, timeouts.spinUpMongoMemoryServer);

beforeEach(async () => {
  const collections = await db.listCollections().toArray();
  for (const col of collections) {
    await db.dropCollection(col['name'] as string);
  }
});

function synthEdges(plan: MigrationPlan): readonly AggregateMigrationEdgeRef[] {
  return [
    buildFabricatedMigrationEdge({
      currentMarkerStorageHash: plan.origin?.storageHash,
      destinationStorageHash: plan.destination.storageHash,
      operationCount: plan.operations.length,
    }),
  ];
}

function makeContract(
  collections: Record<
    string,
    {
      indexes?: Array<{
        keys: Array<{ field: string; direction: 1 | -1 }>;
        unique?: boolean;
        sparse?: boolean;
      }>;
    }
  >,
  storageHash = 'dest',
): MongoContract {
  const storageCollections: Record<string, Record<string, unknown>> = {};
  for (const [name, def] of Object.entries(collections)) {
    storageCollections[name] = { indexes: def.indexes ?? [] };
  }
  // These tests exercise the runner's marker/ledger/policy paths against a
  // real Mongo, not contract canonicalization. Only `storage` is read by the
  // planner here, so the partial structure is shaped to satisfy the runtime
  // path while the cast keeps callers from having to construct a full
  // MongoContract (target/models/capabilities/etc.) that is unused by these
  // tests.
  return {
    storage: {
      storageHash,
      namespaces: {
        __unbound__: {
          id: '__unbound__',
          kind: 'mongo-namespace',
          entries: { collection: storageCollections },
        },
      },
    },
  } as unknown as MongoContract;
}

function bareContract(storageHash: string): MongoContract {
  // The post-apply verify step reads namespace collections via
  // `contractToMongoSchemaIR`, so an empty unbound namespace is
  // required for runner.execute() to reach a passing verify against
  // an unconstrained live schema.
  return {
    storage: {
      storageHash,
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

function planForContract(
  contract: ReturnType<typeof makeContract>,
  origin: MongoSchemaIR = new MongoSchemaIR([]),
  fromContract: MongoContract | null = null,
) {
  const planner = new MongoMigrationPlanner();
  const result = planner.plan({
    contract,
    schema: origin,
    policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
    fromContract,
    frameworkComponents: [],
    snapshotsImportPath: '../../snapshots',
  });
  if (result.kind !== 'success') throw new Error('Planner failed unexpectedly');
  return result.plan;
}

function serializePlan(plan: MigrationPlan): MigrationPlan {
  const serialized = JSON.parse(serializeMongoOps(plan.operations as AnyMongoMigrationOperation[]));
  // Accessor properties on `PlannerProducedMongoMigration` (operations, origin,
  // destination) live on the prototype, so we can't use spread here. Rebuild a
  // plain plan object instead.
  return {
    targetId: plan.targetId,
    operations: serialized,
    origin: plan.origin ?? null,
    destination: plan.destination,
  };
}

function makeRunner() {
  return new MongoMigrationRunner(
    controlAdapter.createRunnerDependencies(new MongoControlDriver(db, client)),
  );
}

describe('MongoMigrationRunner', () => {
  it('creates an index on a real MongoDB instance', async () => {
    const contract = makeContract({
      users: { indexes: [{ keys: [{ field: 'email', direction: 1 }], unique: true }] },
    });
    const plan = planForContract(contract);
    const serialized = serializePlan(plan);

    const runner = makeRunner();
    const result = await runner.execute({
      plan: serialized,
      migrationEdges: synthEdges(plan),
      destinationContract: contract,
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      frameworkComponents: [],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.operationsExecuted).toBe(1);
    }

    const indexes = await db.collection('users').listIndexes().toArray();
    const emailIndex = indexes.find((idx) => idx['key']?.['email'] === 1);
    expect(emailIndex).toBeDefined();
    expect(emailIndex?.['unique']).toBe(true);
  });

  it('drops an index from a real MongoDB instance', async () => {
    await db.createCollection('posts');
    await db.collection('posts').createIndex({ title: 1 }, { name: 'title_1' });

    const originIR = new MongoSchemaIR([
      new MongoSchemaCollection({
        name: 'posts',
        indexes: [
          new MongoSchemaIndex({
            keys: [{ field: 'title', direction: 1 }],
          }),
        ],
      }),
    ]);
    const contract = makeContract({ posts: {} }, 'dropped');
    const plan = planForContract(contract, originIR);
    const serialized = serializePlan(plan);

    const runner = makeRunner();
    const result = await runner.execute({
      plan: serialized,
      migrationEdges: synthEdges(plan),

      destinationContract: contract,
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      frameworkComponents: [],
    });

    expect(result.ok).toBe(true);

    const indexes = await db.collection('posts').listIndexes().toArray();
    const titleIndex = indexes.find((idx) => idx['name'] === 'title_1');
    expect(titleIndex).toBeUndefined();
  });

  it('skips already-applied operations via idempotency probe', async () => {
    await db.createCollection('items');
    await db.collection('items').createIndex({ sku: 1 }, { unique: true, name: 'sku_1' });

    const contract = makeContract({
      items: { indexes: [{ keys: [{ field: 'sku', direction: 1 }], unique: true }] },
    });
    const plan = planForContract(contract);
    const serialized = serializePlan(plan);

    const runner = makeRunner();
    const result = await runner.execute({
      plan: serialized,
      migrationEdges: synthEdges(plan),

      destinationContract: contract,
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      frameworkComponents: [],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.operationsExecuted).toBe(0);
    }
  });

  it('returns PRECHECK_FAILED when prechecks fail', async () => {
    await db.createCollection('users');
    await db.collection('users').createIndex({ email: 1 }, { name: 'email_1' });

    const contract = makeContract({
      users: { indexes: [{ keys: [{ field: 'email', direction: 1 }] }] },
    });
    const plan = planForContract(contract);
    const serialized = serializePlan(plan);

    const runner = makeRunner();
    const result = await runner.execute({
      plan: serialized,
      migrationEdges: synthEdges(plan),

      destinationContract: contract,
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      executionChecks: { idempotencyChecks: false },
      frameworkComponents: [],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('MIGRATION.PRECHECK_FAILED');
    }
  });

  it('executes multiple operations in order', async () => {
    const contract = makeContract({
      alpha: { indexes: [{ keys: [{ field: 'a', direction: 1 }] }] },
      beta: { indexes: [{ keys: [{ field: 'b', direction: 1 }] }] },
    });
    const plan = planForContract(contract);
    const serialized = serializePlan(plan);

    const executedOps: string[] = [];
    const runner = makeRunner();
    const result = await runner.execute({
      plan: serialized,
      migrationEdges: synthEdges(plan),

      destinationContract: contract,
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      callbacks: {
        onOperationStart(op: MigrationPlanOperation) {
          executedOps.push(op.id);
        },
      },
      frameworkComponents: [],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.operationsExecuted).toBe(2);
    }
    expect(executedOps).toHaveLength(2);

    const alphaIndexes = await db.collection('alpha').listIndexes().toArray();
    expect(alphaIndexes.some((idx) => idx['key']?.['a'] === 1)).toBe(true);

    const betaIndexes = await db.collection('beta').listIndexes().toArray();
    expect(betaIndexes.some((idx) => idx['key']?.['b'] === 1)).toBe(true);
  });

  it('returns MARKER_ORIGIN_MISMATCH when marker hash differs', async () => {
    await controlAdapter.initMarker(new MongoControlDriver(db, client), 'app', {
      storageHash: 'different',
      profileHash: 'p1',
    });

    const contract = makeContract({
      users: { indexes: [{ keys: [{ field: 'email', direction: 1 }] }] },
    });
    const plan = planForContract(contract, undefined, bareContract('expected'));
    const serialized = serializePlan(plan);

    const runner = makeRunner();
    const result = await runner.execute({
      plan: serialized,
      migrationEdges: synthEdges(plan),

      destinationContract: contract,
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      frameworkComponents: [],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('MIGRATION.MARKER_ORIGIN_MISMATCH');
    }
  });

  it('proceeds when marker exists but plan has no origin (db update path)', async () => {
    // `plan.origin == null` skips origin validation: the caller (`db update`)
    // does its own correctness check via live-schema introspection, so
    // marker continuity is not required.
    await controlAdapter.initMarker(new MongoControlDriver(db, client), 'app', {
      storageHash: 'existing',
      profileHash: 'p1',
    });

    const contract = makeContract({
      users: { indexes: [{ keys: [{ field: 'email', direction: 1 }] }] },
    });
    const plan = planForContract(contract);
    const serialized = serializePlan(plan);

    const runner = makeRunner();
    const result = await runner.execute({
      plan: serialized,
      migrationEdges: synthEdges(plan),

      destinationContract: contract,
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      frameworkComponents: [],
    });

    expect(result.ok).toBe(true);
  });

  it('returns MARKER_ORIGIN_MISMATCH when no marker but plan has origin', async () => {
    const contract = makeContract({
      users: { indexes: [{ keys: [{ field: 'email', direction: 1 }] }] },
    });
    const plan = planForContract(contract, undefined, bareContract('something'));
    const serialized = serializePlan(plan);

    const runner = makeRunner();
    const result = await runner.execute({
      plan: serialized,
      migrationEdges: synthEdges(plan),

      destinationContract: contract,
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      frameworkComponents: [],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('MIGRATION.MARKER_ORIGIN_MISMATCH');
    }
  });

  it('returns MARKER_CAS_FAILURE when concurrent marker change causes CAS miss', async () => {
    await controlAdapter.initMarker(new MongoControlDriver(db, client), 'app', {
      storageHash: 'origin',
      profileHash: 'profile',
    });

    const contract = makeContract({
      users: { indexes: [{ keys: [{ field: 'email', direction: 1 }] }] },
    });
    const plan = planForContract(contract, undefined, bareContract('origin'));
    const serialized = serializePlan(plan);

    const runner = makeRunner();
    const result = await runner.execute({
      plan: serialized,
      migrationEdges: synthEdges(plan),

      destinationContract: contract,
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      callbacks: {
        async onOperationComplete() {
          await db
            .collection('_prisma_migrations')
            .updateOne(
              { _id: 'app' as never },
              { $set: { storageHash: 'tampered-by-other-process' } },
            );
        },
      },
      frameworkComponents: [],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('MIGRATION.MARKER_CAS_FAILURE');
    }
  });

  it('returns POLICY_VIOLATION for disallowed operation class', async () => {
    const contract = makeContract({
      users: { indexes: [{ keys: [{ field: 'email', direction: 1 }] }] },
    });
    const plan = planForContract(contract);
    const serialized = serializePlan(plan);

    const runner = makeRunner();
    const result = await runner.execute({
      plan: serialized,
      migrationEdges: synthEdges(plan),

      destinationContract: contract,
      policy: { allowedOperationClasses: ['destructive'] },
      frameworkComponents: [],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('MIGRATION.POLICY_VIOLATION');
    }
  });

  it('updates marker and writes ledger entry after successful execution', async () => {
    const contract = makeContract({
      users: { indexes: [{ keys: [{ field: 'email', direction: 1 }] }] },
    });
    const plan = planForContract(contract);
    const serialized = serializePlan(plan);

    const runner = makeRunner();
    await runner.execute({
      plan: serialized,
      migrationEdges: synthEdges(plan),

      destinationContract: contract,
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      frameworkComponents: [],
    });

    const marker = await controlAdapter.readMarker(new MongoControlDriver(db, client), 'app');
    expect(marker).not.toBeNull();
    expect(marker?.storageHash).toBe('dest');

    const ledgerEntries = await db
      .collection('_prisma_migrations')
      .find({ type: 'ledger' })
      .toArray();
    expect(ledgerEntries).toHaveLength(1);
  });
});

describe('MongoMigrationRunner - data transforms', () => {
  function makeDataTransformPlan(ops: unknown[]): MigrationPlan {
    return {
      targetId: 'mongo',
      operations: ops as MigrationPlanOperation[],
      destination: { storageHash: 'dest-dt' },
    };
  }

  function makeCheckSource(collection: string) {
    return {
      collection,
      command: {
        kind: 'rawAggregate',
        collection,
        pipeline: [{ $match: { status: { $exists: false } } }, { $limit: 1 }],
      },
      meta: { target: 'mongo', storageHash: 'x', lane: 'mongo-raw' },
    };
  }

  function makePrecheckObj(collection: string) {
    return {
      description: `Check for ${collection}`,
      source: makeCheckSource(collection),
      filter: { kind: 'exists', field: '_id', exists: true },
      expect: 'exists' as const,
    };
  }

  function makePostcheckObj(collection: string) {
    return {
      description: `Check for ${collection}`,
      source: makeCheckSource(collection),
      filter: { kind: 'exists', field: '_id', exists: true },
      expect: 'notExists' as const,
    };
  }

  it('executes a data transform with empty precheck (always run)', async () => {
    await db.createCollection('users');

    const op = {
      id: 'data_transform.backfill',
      label: 'Data transform: backfill',
      operationClass: 'data',
      name: 'backfill',
      precheck: [],
      run: [
        {
          collection: 'users',
          command: {
            kind: 'rawInsertMany',
            collection: 'users',
            documents: [{ name: 'Alice' }, { name: 'Bob' }],
          },
          meta: {
            target: 'mongo',
            storageHash: 'x',
            lane: 'mongo-raw',
          },
        },
      ],
      postcheck: [],
    };

    const runner = makeRunner();
    const result = await runner.execute({
      plan: makeDataTransformPlan([op]),
      migrationEdges: synthEdges(makeDataTransformPlan([op])),
      destinationContract: bareContract('dest-dt'),
      policy: { allowedOperationClasses: ['data'] },
      strictVerification: false,
      frameworkComponents: [],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.operationsExecuted).toBe(1);
    }

    const docs = await db.collection('users').find().toArray();
    expect(docs).toHaveLength(2);
  });

  it('skips via idempotency check when postcheck query returns empty', async () => {
    await db.createCollection('users');

    const op = {
      id: 'data_transform.backfill',
      label: 'Data transform: backfill',
      operationClass: 'data',
      name: 'backfill',
      precheck: [makePrecheckObj('users')],
      run: [
        {
          collection: 'users',
          command: {
            kind: 'rawUpdateMany',
            collection: 'users',
            filter: { status: { $exists: false } },
            update: { $set: { status: 'active' } },
          },
          meta: {
            target: 'mongo',
            storageHash: 'x',
            lane: 'mongo-raw',
          },
        },
      ],
      postcheck: [makePostcheckObj('users')],
    };

    const runner = makeRunner();
    const result = await runner.execute({
      plan: makeDataTransformPlan([op]),
      migrationEdges: synthEdges(makeDataTransformPlan([op])),
      destinationContract: bareContract('dest-dt'),
      policy: { allowedOperationClasses: ['data'] },
      strictVerification: false,
      frameworkComponents: [],
    });

    // Empty collection ⇒ postcheck (`expect: 'notExists'` on docs missing
    // `status`) is satisfied up-front, so the data transform is skipped and
    // does not contribute to `operationsExecuted`.
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.operationsExecuted).toBe(0);
    }
  });

  it('executes run when check query finds violations', async () => {
    await db.createCollection('users');
    await db.collection('users').insertMany([{ name: 'Alice' }, { name: 'Bob' }]);

    const op = {
      id: 'data_transform.backfill-status',
      label: 'Data transform: backfill-status',
      operationClass: 'data',
      name: 'backfill-status',
      precheck: [makePrecheckObj('users')],
      run: [
        {
          collection: 'users',
          command: {
            kind: 'rawUpdateMany',
            collection: 'users',
            filter: { status: { $exists: false } },
            update: { $set: { status: 'active' } },
          },
          meta: {
            target: 'mongo',
            storageHash: 'x',
            lane: 'mongo-raw',
          },
        },
      ],
      postcheck: [makePostcheckObj('users')],
    };

    const runner = makeRunner();
    const result = await runner.execute({
      plan: makeDataTransformPlan([op]),
      migrationEdges: synthEdges(makeDataTransformPlan([op])),
      destinationContract: bareContract('dest-dt'),
      policy: { allowedOperationClasses: ['data'] },
      strictVerification: false,
      frameworkComponents: [],
    });

    expect(result.ok).toBe(true);

    const docs = await db.collection('users').find().toArray();
    expect(docs.every((d) => d['status'] === 'active')).toBe(true);
  });

  it('returns POSTCHECK_FAILED when run does not fix all violations', async () => {
    await db.createCollection('users');
    await db.collection('users').insertMany([{ name: 'Alice' }, { name: 'Bob' }]);

    const op = {
      id: 'data_transform.partial-fix',
      label: 'Data transform: partial-fix',
      operationClass: 'data',
      name: 'partial-fix',
      precheck: [makePrecheckObj('users')],
      run: [
        {
          collection: 'users',
          command: {
            kind: 'rawUpdateOne',
            collection: 'users',
            filter: { name: 'Alice' },
            update: { $set: { status: 'active' } },
          },
          meta: {
            target: 'mongo',
            storageHash: 'x',
            lane: 'mongo-raw',
          },
        },
      ],
      postcheck: [makePostcheckObj('users')],
    };

    const runner = makeRunner();
    const result = await runner.execute({
      plan: makeDataTransformPlan([op]),
      migrationEdges: synthEdges(makeDataTransformPlan([op])),
      destinationContract: bareContract('dest-dt'),
      policy: { allowedOperationClasses: ['data'] },
      frameworkComponents: [],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('MIGRATION.POSTCHECK_FAILED');
    }
  });

  it('returns POLICY_VIOLATION when data class not allowed', async () => {
    const op = {
      id: 'data_transform.test',
      label: 'Data transform: test',
      operationClass: 'data',
      name: 'test',
      precheck: [],
      run: [],
      postcheck: [],
    };

    const runner = makeRunner();
    const result = await runner.execute({
      plan: makeDataTransformPlan([op]),
      migrationEdges: synthEdges(makeDataTransformPlan([op])),
      destinationContract: bareContract('dest-dt'),
      policy: { allowedOperationClasses: ['additive'] },
      frameworkComponents: [],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('MIGRATION.POLICY_VIOLATION');
    }
  });
});

describe('MongoMigrationRunner - E2E round-trip', () => {
  it('serialize → deserialize → execute mixed DDL + data transform', async () => {
    const { dataTransform } = await import('@internal/target-mongo/migration');
    const { RawUpdateManyCommand, RawAggregateCommand } = await import(
      '@internal/mongo-query-ast/execution'
    );

    const planner = new MongoMigrationPlanner();
    const contract = makeContract({
      orders: { indexes: [{ keys: [{ field: 'createdAt', direction: -1 }] }] },
    });
    const ddlResult = planner.plan({
      contract,
      schema: new MongoSchemaIR([]),
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      fromContract: bareContract('00'),
      frameworkComponents: [],
      snapshotsImportPath: '../../snapshots',
    });
    if (ddlResult.kind !== 'success') throw new Error('Planner failed');

    const dtOp = dataTransform('backfill-status', {
      check: {
        source: () => ({
          collection: 'orders',
          command: new RawAggregateCommand('orders', [
            { $match: { status: { $exists: false } } },
            { $limit: 1 },
          ]),
          meta: {
            target: 'mongo',
            storageHash: 'x',
            lane: 'mongo-raw',
          },
        }),
      },
      run: () => ({
        collection: 'orders',
        command: new RawUpdateManyCommand(
          'orders',
          { status: { $exists: false } },
          { $set: { status: 'pending' } },
        ),
        meta: { target: 'mongo', storageHash: 'x', lane: 'mongo-raw' },
      }),
    });

    const allOps = [...ddlResult.plan.operations, dtOp] as AnyMongoMigrationOperation[];

    const serializedJson = serializeMongoOps(allOps);

    const plan: MigrationPlan = {
      targetId: 'mongo',
      operations: JSON.parse(serializedJson) as MigrationPlanOperation[],
      destination: { storageHash: 'dest-e2e' },
    };

    // Seed a row that needs the backfill so the data transform actually runs;
    // without seed data the postcheck (`status` exists on every doc) is
    // trivially satisfied and the runner would skip it.
    await db.createCollection('orders');
    await db.collection('orders').insertOne({ ref: 'A1' });

    const runner = makeRunner();
    const result = await runner.execute({
      plan,
      migrationEdges: synthEdges(plan),
      destinationContract: contract,
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'] },
      frameworkComponents: [],
    });

    // 1 createIndex (the planner does not emit createCollection for plain
    // collections without options/validators) + 1 data transform that
    // backfills the seeded row.
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.operationsExecuted).toBe(2);
    }

    const indexes = await db.collection('orders').listIndexes().toArray();
    const createdAtIdx = indexes.find((idx) => idx['key']?.['createdAt'] === -1);
    expect(createdAtIdx).toBeDefined();

    const orders = await db.collection('orders').find().toArray();
    expect(orders.every((o) => o['status'] === 'pending')).toBe(true);
  });

  it('retry safety: re-running completed data transform is skipped by postcheck', async () => {
    await db.createCollection('accounts');
    await db.collection('accounts').insertMany([{ name: 'Acme', active: true }, { name: 'Beta' }]);

    const checkSource = {
      collection: 'accounts',
      command: {
        kind: 'rawAggregate' as const,
        collection: 'accounts',
        pipeline: [{ $match: { active: { $exists: false } } }, { $limit: 1 }],
      },
      meta: { target: 'mongo', storageHash: 'x', lane: 'mongo-raw' },
    };

    const op = {
      id: 'data_transform.backfill-active',
      label: 'Data transform: backfill-active',
      operationClass: 'data' as const,
      name: 'backfill-active',
      precheck: [
        {
          description: 'Check for accounts',
          source: checkSource,
          filter: { kind: 'exists', field: '_id', exists: true },
          expect: 'exists' as const,
        },
      ],
      run: [
        {
          collection: 'accounts',
          command: {
            kind: 'rawUpdateMany' as const,
            collection: 'accounts',
            filter: { active: { $exists: false } },
            update: { $set: { active: false } },
          },
          meta: {
            target: 'mongo',
            storageHash: 'x',
            lane: 'mongo-raw',
          },
        },
      ],
      postcheck: [
        {
          description: 'Check for accounts',
          source: checkSource,
          filter: { kind: 'exists', field: '_id', exists: true },
          expect: 'notExists' as const,
        },
      ],
    };

    const plan: MigrationPlan = {
      targetId: 'mongo',
      operations: [op] as unknown as MigrationPlanOperation[],
      destination: { storageHash: 'retry' },
    };

    const runner = makeRunner();

    const result1 = await runner.execute({
      plan,
      migrationEdges: synthEdges(plan),
      destinationContract: bareContract('retry'),
      policy: { allowedOperationClasses: ['data'] },
      strictVerification: false,
      frameworkComponents: [],
    });
    expect(result1.ok).toBe(true);

    const docsAfterFirst = await db.collection('accounts').find().toArray();
    expect(docsAfterFirst.every((d) => typeof d['active'] === 'boolean')).toBe(true);

    await db.collection('_prisma_migrations').drop();

    const result2 = await runner.execute({
      plan,
      migrationEdges: synthEdges(plan),
      destinationContract: bareContract('retry'),
      policy: { allowedOperationClasses: ['data'] },
      strictVerification: false,
      frameworkComponents: [],
    });
    // Marker has been wiped, but the postcheck (no docs missing `active`) is
    // already satisfied, so the runner skips the data transform without
    // counting it as executed.
    expect(result2.ok).toBe(true);
    if (result2.ok) {
      expect(result2.value.operationsExecuted).toBe(0);
    }
  });
});

describe('mongoTargetDescriptor migrations.createRunner — per-edge ledger', () => {
  it('threads migrationEdges through createRunner().execute() into per-edge ledger docs', async () => {
    const family = mongoFamilyDescriptor.create(
      createControlStack({
        family: mongoFamilyDescriptor,
        target: mongoTargetDescriptor,
        adapter: mongoAdapterDescriptor,
      }),
    );
    const runner = mongoTargetDescriptor.migrations.createRunner(family);
    const driver = new MongoControlDriver(db, client);
    const space = 'ledger-wrapper-test';
    const destHash = 'wrapper-dest';
    const midHash = 'wrapper-mid';
    const contract = bareContract(destHash);
    const edges: readonly AggregateMigrationEdgeRef[] = [
      {
        migrationHash: 'mig-a',
        dirName: '001_a',
        from: EMPTY_CONTRACT_HASH,
        to: midHash,
        operationCount: 1,
      },
      {
        migrationHash: 'mig-b',
        dirName: '002_b',
        from: midHash,
        to: destHash,
        operationCount: 1,
      },
    ];
    const plan: MigrationPlan = {
      targetId: 'mongo',
      spaceId: space,
      origin: null,
      destination: { storageHash: destHash },
      operations: JSON.parse(
        serializeMongoOps([createCollection('wrapper_a'), createCollection('wrapper_b')]),
      ) as MigrationPlan['operations'],
    };

    const result = await runner.execute({
      driver,
      perSpaceOptions: [
        {
          space,
          plan,
          driver,
          destinationContract: contract,
          policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
          frameworkComponents: [],
          strictVerification: false,
          executionChecks: { prechecks: false, postchecks: false, idempotencyChecks: false },
          migrationEdges: edges,
        },
      ],
    });

    expect(result.ok).toBe(true);
    const ledger = await controlAdapter.readLedger(new MongoControlDriver(db, client), space);
    expect(ledger).toHaveLength(2);
    expect(ledger.map((entry) => entry.migrationName)).toEqual(['001_a', '002_b']);
    expect(ledger.map((entry) => entry.migrationHash)).toEqual(['mig-a', 'mig-b']);
  });
});

describe('MongoControlDriver', () => {
  it('close() delegates to the underlying MongoClient', async () => {
    const closeClient = new MongoClient(replSet.getUri());
    await closeClient.connect();
    const closeDb = closeClient.db('close_test');
    const driver = new MongoControlDriver(closeDb, closeClient);

    await driver.close();

    await expect(closeClient.db('close_test').command({ ping: 1 })).rejects.toThrow();
  });
});
