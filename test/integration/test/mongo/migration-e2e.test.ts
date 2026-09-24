import { MongoControlAdapterImpl } from '@internal/adapter-mongo/control';
import { coreHash, crossRef, profileHash } from '@internal/contract/types';
import mongoControlDriver, { MongoControlDriver } from '@internal/driver-mongo/control';
import { contractToMongoSchemaIR } from '@internal/family-mongo/control';
import { MongoCollection, type MongoContract, MongoIndex } from '@internal/mongo-contract';
import type { MongoMigrationPlanOperation } from '@internal/mongo-query-ast/control';
import {
  MongoMigrationPlanner,
  MongoMigrationRunner,
  serializeMongoOps,
} from '@internal/target-mongo/control';
import { applicationDomainOf, timeouts } from '@repo/test-utils';
import { type Db, MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildFabricatedMigrationEdges } from './fabricated-migration-edges';

const controlAdapter = new MongoControlAdapterImpl();

const MIGRATIONS_COLLECTION = '_prisma_migrations';

const emptyContract: MongoContract = {
  target: 'mongo',
  targetFamily: 'mongo',
  roots: { users: crossRef('User') },
  domain: applicationDomainOf({
    models: {
      User: {
        fields: {
          _id: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/objectId@1' } },
          email: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
        },
        relations: {},
        storage: { collection: 'users' },
      },
    },
  }),
  storage: {
    namespaces: {
      __unbound__: {
        id: '__unbound__' as const,
        kind: 'mongo-namespace' as const,
        entries: {
          collection: {
            users: new MongoCollection(),
          },
        },
      },
    },
    storageHash: coreHash('empty-contract'),
  },
  capabilities: {},
  extensions: {},
  profileHash: profileHash('test'),
  meta: {},
};

const indexedContract: MongoContract = {
  target: 'mongo',
  targetFamily: 'mongo',
  roots: { users: crossRef('User') },
  domain: applicationDomainOf({
    models: {
      User: {
        fields: {
          _id: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/objectId@1' } },
          email: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
        },
        relations: {},
        storage: { collection: 'users' },
      },
    },
  }),
  storage: {
    namespaces: {
      __unbound__: {
        id: '__unbound__' as const,
        kind: 'mongo-namespace' as const,
        entries: {
          collection: {
            users: new MongoCollection({
              indexes: [
                new MongoIndex({ keys: [{ field: 'email', direction: 1 as const }], unique: true }),
              ],
            }),
          },
        },
      },
    },
    storageHash: coreHash('indexed-contract'),
  },
  capabilities: {},
  extensions: {},
  profileHash: profileHash('test'),
  meta: {},
};

const ALL_POLICY = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'] as const,
};

describe('MongoDB migration E2E', { timeout: timeouts.spinUpMongoMemoryServer }, () => {
  let replSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  const dbName = 'migration_e2e_test';

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      instanceOpts: [
        { launchTimeout: timeouts.spinUpMongoMemoryServer, storageEngine: 'wiredTiger' },
      ],
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    client = new MongoClient(replSet.getUri());
    await client.connect();
    db = client.db(dbName);
  }, timeouts.spinUpMongoMemoryServer);

  beforeEach(async () => {
    await db.dropDatabase();
  });

  afterAll(async () => {
    try {
      await client?.close();
      await replSet?.stop();
    } catch {
      // Ignore cleanup errors
    }
  }, timeouts.spinUpMongoMemoryServer);

  describe('plan + apply create index', () => {
    it('plans a createIndex operation from empty to indexed contract', async () => {
      const planner = new MongoMigrationPlanner();
      const schema = contractToMongoSchemaIR(null);
      const result = planner.plan({
        contract: indexedContract,
        schema,
        policy: ALL_POLICY,
        fromContract: null,
        frameworkComponents: [],
        snapshotsImportPath: '../../snapshots',
      });

      expect(result.kind).toBe('success');
      if (result.kind !== 'success') return;

      expect(result.plan.operations).toHaveLength(1);
      const op = await result.plan.operations[0]!;
      expect(op.operationClass).toBe('additive');
      expect(op.label).toContain('Create index');
      expect(op.label).toContain('users');
    });

    it('applies createIndex and verifies the index exists on MongoDB', async () => {
      const planner = new MongoMigrationPlanner();
      const schema = contractToMongoSchemaIR(null);
      const result = planner.plan({
        contract: indexedContract,
        schema,
        policy: ALL_POLICY,
        fromContract: null,
        frameworkComponents: [],
        snapshotsImportPath: '../../snapshots',
      });
      if (result.kind !== 'success') throw new Error('Plan failed unexpectedly');

      const ops = result.plan.operations as readonly MongoMigrationPlanOperation[];
      const serialized = JSON.parse(serializeMongoOps(ops));

      const controlDriver = await mongoControlDriver.create(replSet.getUri(dbName));
      try {
        const runner = new MongoMigrationRunner(
          controlAdapter.createRunnerDependencies(controlDriver),
        );
        const plan = {
          targetId: 'mongo',
          destination: { storageHash: indexedContract.storage.storageHash },
          operations: serialized,
        };
        const runResult = await runner.execute({
          plan,
          migrationEdges: buildFabricatedMigrationEdges(plan),
          destinationContract: indexedContract,
          policy: ALL_POLICY,
          frameworkComponents: [],
        });

        expect(runResult.ok).toBe(true);
        if (!runResult.ok) return;
        expect(runResult.value.operationsPlanned).toBe(1);
        expect(runResult.value.operationsExecuted).toBe(1);

        const indexes = await db.collection('users').listIndexes().toArray();
        const emailIndex = indexes.find((idx) => idx['key'] && idx['key']['email'] === 1);
        expect(emailIndex).toBeDefined();
        expect(emailIndex!['unique']).toBe(true);
      } finally {
        await controlDriver.close();
      }
    });

    it('updates the marker with the destination hash', async () => {
      const planner = new MongoMigrationPlanner();
      const schema = contractToMongoSchemaIR(null);
      const result = planner.plan({
        contract: indexedContract,
        schema,
        policy: ALL_POLICY,
        fromContract: null,
        frameworkComponents: [],
        snapshotsImportPath: '../../snapshots',
      });
      if (result.kind !== 'success') throw new Error('Plan failed');

      const ops = result.plan.operations as readonly MongoMigrationPlanOperation[];
      const serialized = JSON.parse(serializeMongoOps(ops));

      const controlDriver = await mongoControlDriver.create(replSet.getUri(dbName));
      try {
        const runner = new MongoMigrationRunner(
          controlAdapter.createRunnerDependencies(controlDriver),
        );
        const plan = {
          targetId: 'mongo',
          destination: { storageHash: indexedContract.storage.storageHash },
          operations: serialized,
        };
        await runner.execute({
          plan,
          migrationEdges: buildFabricatedMigrationEdges(plan),
          destinationContract: indexedContract,
          policy: ALL_POLICY,
          frameworkComponents: [],
        });

        const marker = await controlAdapter.readMarker(new MongoControlDriver(db, client), 'app');
        expect(marker).not.toBeNull();
        expect(marker!.storageHash).toBe(indexedContract.storage.storageHash);
      } finally {
        await controlDriver.close();
      }
    });

    it('records a ledger entry', async () => {
      const planner = new MongoMigrationPlanner();
      const schema = contractToMongoSchemaIR(null);
      const result = planner.plan({
        contract: indexedContract,
        schema,
        policy: ALL_POLICY,
        fromContract: null,
        frameworkComponents: [],
        snapshotsImportPath: '../../snapshots',
      });
      if (result.kind !== 'success') throw new Error('Plan failed');

      const ops = result.plan.operations as readonly MongoMigrationPlanOperation[];
      const serialized = JSON.parse(serializeMongoOps(ops));

      const controlDriver = await mongoControlDriver.create(replSet.getUri(dbName));
      try {
        const runner = new MongoMigrationRunner(
          controlAdapter.createRunnerDependencies(controlDriver),
        );
        const plan = {
          targetId: 'mongo',
          destination: { storageHash: indexedContract.storage.storageHash },
          operations: serialized,
        };
        await runner.execute({
          plan,
          migrationEdges: buildFabricatedMigrationEdges(plan),
          destinationContract: indexedContract,
          policy: ALL_POLICY,
          frameworkComponents: [],
        });

        const ledgerEntries = await db
          .collection(MIGRATIONS_COLLECTION)
          .find({ type: 'ledger' })
          .toArray();
        expect(ledgerEntries).toHaveLength(1);
        expect(ledgerEntries[0]!['to']).toBe(indexedContract.storage.storageHash);
      } finally {
        await controlDriver.close();
      }
    });
  });

  describe('plan + apply drop index', () => {
    it('drops an index when the destination contract removes it', async () => {
      const controlDriver = await mongoControlDriver.create(replSet.getUri(dbName));
      try {
        const planner = new MongoMigrationPlanner();
        const runner = new MongoMigrationRunner(
          controlAdapter.createRunnerDependencies(controlDriver),
        );

        // Step 1: Apply create index
        const createSchema = contractToMongoSchemaIR(null);
        const createResult = planner.plan({
          contract: indexedContract,
          schema: createSchema,
          policy: ALL_POLICY,
          fromContract: null,
          frameworkComponents: [],
          snapshotsImportPath: '../../snapshots',
        });
        if (createResult.kind !== 'success') throw new Error('Create plan failed');

        const createOps = createResult.plan.operations as readonly MongoMigrationPlanOperation[];
        const createSerialized = JSON.parse(serializeMongoOps(createOps));
        const createPlan = {
          targetId: 'mongo',
          destination: { storageHash: indexedContract.storage.storageHash },
          operations: createSerialized,
        };
        await runner.execute({
          plan: createPlan,
          migrationEdges: buildFabricatedMigrationEdges(createPlan),
          destinationContract: indexedContract,
          policy: ALL_POLICY,
          frameworkComponents: [],
        });

        // Verify index exists
        let indexes = await db.collection('users').listIndexes().toArray();
        expect(indexes.some((idx) => idx['key']?.['email'] === 1)).toBe(true);

        // Step 2: Plan drop (indexed -> empty)
        const dropSchema = contractToMongoSchemaIR(indexedContract);
        const dropResult = planner.plan({
          contract: emptyContract,
          schema: dropSchema,
          policy: ALL_POLICY,
          fromContract: indexedContract,
          frameworkComponents: [],
          snapshotsImportPath: '../../snapshots',
        });
        if (dropResult.kind !== 'success') throw new Error('Drop plan failed');

        expect(dropResult.plan.operations).toHaveLength(1);
        const dropOp = await dropResult.plan.operations[0]!;
        expect(dropOp.operationClass).toBe('destructive');
        expect(dropOp.label).toContain('Drop index');

        // Step 3: Apply drop
        const dropOps = dropResult.plan.operations as readonly MongoMigrationPlanOperation[];
        const dropSerialized = JSON.parse(serializeMongoOps(dropOps));
        const dropPlan = {
          targetId: 'mongo',
          origin: { storageHash: indexedContract.storage.storageHash },
          destination: { storageHash: emptyContract.storage.storageHash },
          operations: dropSerialized,
        };
        const dropRunResult = await runner.execute({
          plan: dropPlan,
          migrationEdges: buildFabricatedMigrationEdges(dropPlan),
          destinationContract: emptyContract,
          policy: ALL_POLICY,
          frameworkComponents: [],
        });

        expect(dropRunResult.ok).toBe(true);

        // Verify index is gone (only _id index remains)
        indexes = await db.collection('users').listIndexes().toArray();
        const emailIndex = indexes.find((idx) => idx['key']?.['email'] === 1);
        expect(emailIndex).toBeUndefined();

        // Verify marker updated
        const marker = await controlAdapter.readMarker(new MongoControlDriver(db, client), 'app');
        expect(marker!.storageHash).toBe(emptyContract.storage.storageHash);

        // Verify second ledger entry with correct target hash
        const ledgerEntries = await db
          .collection(MIGRATIONS_COLLECTION)
          .find({ type: 'ledger' })
          .toArray();
        expect(ledgerEntries).toHaveLength(2);
        const dropLedger = ledgerEntries.find((e) => e['to'] === emptyContract.storage.storageHash);
        expect(dropLedger).toBeDefined();
        expect(dropLedger!['from']).toBe(indexedContract.storage.storageHash);
      } finally {
        await controlDriver.close();
      }
    });
  });

  describe('idempotent re-apply', () => {
    it('skips operations when postchecks already satisfied', async () => {
      const controlDriver = await mongoControlDriver.create(replSet.getUri(dbName));
      try {
        const planner = new MongoMigrationPlanner();
        const runner = new MongoMigrationRunner(
          controlAdapter.createRunnerDependencies(controlDriver),
        );

        // First apply
        const schema = contractToMongoSchemaIR(null);
        const result = planner.plan({
          contract: indexedContract,
          schema,
          policy: ALL_POLICY,
          fromContract: null,
          frameworkComponents: [],
          snapshotsImportPath: '../../snapshots',
        });
        if (result.kind !== 'success') throw new Error('Plan failed');

        const ops = result.plan.operations as readonly MongoMigrationPlanOperation[];
        const serialized = JSON.parse(serializeMongoOps(ops));
        const bootstrapPlan = {
          targetId: 'mongo' as const,
          destination: { storageHash: indexedContract.storage.storageHash },
          operations: serialized,
        };

        await runner.execute({
          plan: bootstrapPlan,
          migrationEdges: buildFabricatedMigrationEdges(bootstrapPlan),
          destinationContract: indexedContract,
          policy: ALL_POLICY,
          frameworkComponents: [],
        });

        // Second apply (same plan with origin) — idempotent
        const reapplyPlan = {
          ...bootstrapPlan,
          origin: { storageHash: indexedContract.storage.storageHash },
        };
        const reapplyResult = await runner.execute({
          plan: reapplyPlan,
          migrationEdges: buildFabricatedMigrationEdges(reapplyPlan),
          destinationContract: indexedContract,
          policy: ALL_POLICY,
          frameworkComponents: [],
          executionChecks: { prechecks: true, postchecks: true, idempotencyChecks: true },
        });

        expect(reapplyResult.ok).toBe(true);
        if (!reapplyResult.ok) return;
        expect(reapplyResult.value.operationsPlanned).toBe(1);
        expect(reapplyResult.value.operationsExecuted).toBe(0);
      } finally {
        await controlDriver.close();
      }
    });
  });

  describe('full lifecycle via control driver descriptor', () => {
    it('create(url) produces a driver compatible with the migration runner', async () => {
      const url = replSet.getUri(dbName);
      const controlDriver = await mongoControlDriver.create(url);
      try {
        expect(controlDriver.familyId).toBe('mongo');
        expect(controlDriver.db.databaseName).toBe(dbName);

        const planner = new MongoMigrationPlanner();
        const runner = new MongoMigrationRunner(
          controlAdapter.createRunnerDependencies(controlDriver),
        );
        const schema = contractToMongoSchemaIR(null);
        const result = planner.plan({
          contract: indexedContract,
          schema,
          policy: ALL_POLICY,
          fromContract: null,
          frameworkComponents: [],
          snapshotsImportPath: '../../snapshots',
        });
        if (result.kind !== 'success') throw new Error('Plan failed');

        const ops = result.plan.operations as readonly MongoMigrationPlanOperation[];
        const serialized = JSON.parse(serializeMongoOps(ops));
        const plan = {
          targetId: 'mongo',
          destination: { storageHash: indexedContract.storage.storageHash },
          operations: serialized,
        };
        const runResult = await runner.execute({
          plan,
          migrationEdges: buildFabricatedMigrationEdges(plan),
          destinationContract: indexedContract,
          policy: ALL_POLICY,
          frameworkComponents: [],
        });

        expect(runResult.ok).toBe(true);
      } finally {
        await controlDriver.close();
      }
    });
  });
});
