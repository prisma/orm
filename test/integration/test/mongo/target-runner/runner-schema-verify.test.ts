import { MongoControlAdapterImpl } from '@internal/adapter-mongo/control';
import { MongoControlDriver } from '@internal/driver-mongo/control';
import type { MigrationPlan } from '@internal/framework-components/control';
import {
  type AggregateMigrationEdgeRef,
  buildFabricatedMigrationEdge,
} from '@internal/migration-tools/aggregate';
import type { MongoContract } from '@internal/mongo-contract';
import type { AnyMongoMigrationOperation } from '@internal/mongo-query-ast/control';
import { MongoSchemaIR } from '@internal/mongo-schema-ir';
import {
  MongoMigrationPlanner,
  MongoMigrationRunner,
  serializeMongoOps,
} from '@internal/target-mongo/control';
import { timeouts } from '@repo/test-utils';
import { type Db, MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const controlAdapter = new MongoControlAdapterImpl();

let replSet: MongoMemoryReplSet;
let client: MongoClient;
let db: Db;
const dbName = 'runner_verify_test';

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
  // Same rationale as `makeContract` in `mongo-runner.test.ts`: only the
  // storage face of the contract is read by the planner + verifier here, so
  // the partial structure is shaped to satisfy the runtime path while the
  // cast spares callers from constructing a full MongoContract that would
  // be unused by these tests.
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

function planForContract(
  contract: ReturnType<typeof makeContract>,
  origin: MongoSchemaIR = new MongoSchemaIR([]),
): MigrationPlan {
  const planner = new MongoMigrationPlanner();
  const result = planner.plan({
    contract,
    schema: origin,
    policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
    fromContract: null,
    frameworkComponents: [],
    snapshotsImportPath: '../../snapshots',
  });
  if (result.kind !== 'success') throw new Error('Planner failed unexpectedly');
  return result.plan;
}

function serializePlan(plan: MigrationPlan): MigrationPlan {
  const serialized = JSON.parse(serializeMongoOps(plan.operations as AnyMongoMigrationOperation[]));
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

function synthEdges(plan: MigrationPlan): readonly AggregateMigrationEdgeRef[] {
  return [
    buildFabricatedMigrationEdge({
      currentMarkerStorageHash: plan.origin?.storageHash,
      destinationStorageHash: plan.destination.storageHash,
      operationCount: plan.operations.length,
    }),
  ];
}

describe('MongoMigrationRunner schema verification (integration)', () => {
  it('verifies the live schema, then writes marker + ledger when it matches the contract', async () => {
    const contract = makeContract({
      users: { indexes: [{ keys: [{ field: 'email', direction: 1 }], unique: true }] },
    });
    const plan = serializePlan(planForContract(contract));

    const runner = makeRunner();
    const result = await runner.execute({
      plan,
      migrationEdges: synthEdges(plan),
      destinationContract: contract,
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      frameworkComponents: [],
    });

    expect(result.ok).toBe(true);

    const marker = await controlAdapter.readMarker(new MongoControlDriver(db, client), 'app');
    expect(marker?.storageHash).toBe('dest');

    const ledgerEntries = await db
      .collection('_prisma_migrations')
      .find({ type: 'ledger' })
      .toArray();
    expect(ledgerEntries).toHaveLength(1);

    const liveIndexes = await db.collection('users').listIndexes().toArray();
    const emailIndex = liveIndexes.find((idx) => idx['key']?.['email'] === 1);
    expect(emailIndex?.['unique']).toBe(true);
  });

  it('returns SCHEMA_VERIFY_FAILED on tampered DB, leaves marker unwritten, then succeeds after the drift is fixed', async () => {
    await db.createCollection('users');
    await db.collection('users').createIndex({ legacy_field: 1 }, { name: 'legacy_field_1' });

    const contract = makeContract({
      users: { indexes: [{ keys: [{ field: 'email', direction: 1 }], unique: true }] },
    });
    const plan = serializePlan(planForContract(contract));

    const runner = makeRunner();
    const tamperedResult = await runner.execute({
      plan,
      migrationEdges: synthEdges(plan),
      destinationContract: contract,
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      frameworkComponents: [],
    });

    expect(tamperedResult.ok).toBe(false);
    if (!tamperedResult.ok) {
      expect(tamperedResult.failure.code).toBe('MIGRATION.SCHEMA_VERIFY_FAILED');
      const issues = tamperedResult.failure.meta?.['issues'];
      expect(Array.isArray(issues)).toBe(true);
      expect((issues as readonly unknown[]).length).toBeGreaterThan(0);
    }

    const markerAfterFailure = await controlAdapter.readMarker(
      new MongoControlDriver(db, client),
      'app',
    );
    expect(markerAfterFailure).toBeNull();

    const ledgerAfterFailure = await db
      .collection('_prisma_migrations')
      .find({ type: 'ledger' })
      .toArray();
    expect(ledgerAfterFailure).toHaveLength(0);

    await db.collection('users').dropIndex('legacy_field_1');

    const recoveryResult = await runner.execute({
      plan,
      migrationEdges: synthEdges(plan),
      destinationContract: contract,
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      frameworkComponents: [],
    });

    expect(recoveryResult.ok).toBe(true);
    if (recoveryResult.ok) {
      expect(recoveryResult.value.operationsExecuted).toBe(0);
    }

    const markerAfterRecovery = await controlAdapter.readMarker(
      new MongoControlDriver(db, client),
      'app',
    );
    expect(markerAfterRecovery?.storageHash).toBe('dest');

    const ledgerAfterRecovery = await db
      .collection('_prisma_migrations')
      .find({ type: 'ledger' })
      .toArray();
    expect(ledgerAfterRecovery).toHaveLength(1);
  });

  it('passes verification with strictVerification: false even when the live DB has out-of-band structure', async () => {
    await db.createCollection('users');
    await db.collection('users').createIndex({ legacy_field: 1 }, { name: 'legacy_field_1' });

    const contract = makeContract({
      users: { indexes: [{ keys: [{ field: 'email', direction: 1 }], unique: true }] },
    });
    const plan = serializePlan(planForContract(contract));

    const runner = makeRunner();
    const result = await runner.execute({
      plan,
      migrationEdges: synthEdges(plan),
      destinationContract: contract,
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      strictVerification: false,
      frameworkComponents: [],
    });

    expect(result.ok).toBe(true);

    const marker = await controlAdapter.readMarker(new MongoControlDriver(db, client), 'app');
    expect(marker?.storageHash).toBe('dest');

    const ledgerEntries = await db
      .collection('_prisma_migrations')
      .find({ type: 'ledger' })
      .toArray();
    expect(ledgerEntries).toHaveLength(1);

    const liveIndexes = await db.collection('users').listIndexes().toArray();
    expect(liveIndexes.some((idx) => idx['name'] === 'legacy_field_1')).toBe(true);
    expect(liveIndexes.some((idx) => idx['key']?.['email'] === 1)).toBe(true);
  });
});
