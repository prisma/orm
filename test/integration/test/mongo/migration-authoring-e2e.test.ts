import { MongoControlAdapterImpl } from '@internal/adapter-mongo/control';
import mongoControlDriver from '@internal/driver-mongo/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { MongoContract } from '@internal/mongo-contract';
import type { AnyMongoMigrationOperation } from '@internal/mongo-query-ast/control';
import {
  deserializeMongoOps,
  MongoMigrationRunner,
  serializeMongoOps,
} from '@internal/target-mongo/control';
import {
  createCollection,
  createIndex,
  dropCollection,
  dropIndex,
  setValidation,
  validatedCollection,
} from '@internal/target-mongo/migration';
import { timeouts } from '@repo/test-utils';
import { type Db, MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildFabricatedMigrationEdges } from './fabricated-migration-edges';

const ALL_POLICY = {
  allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'] as const,
};

describe('Migration authoring round-trip (factory → serialize → deserialize → runner → DB)', {
  timeout: timeouts.spinUpMongoMemoryServer,
}, () => {
  let replSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  const dbName = 'authoring_e2e_test';

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
    await Promise.allSettled([
      client?.close() ?? Promise.resolve(),
      replSet?.stop() ?? Promise.resolve(),
    ]);
  }, timeouts.spinUpMongoMemoryServer);

  async function runOps(ops: readonly AnyMongoMigrationOperation[]): Promise<{
    operationsPlanned: number;
    operationsExecuted: number;
  }> {
    const serialized = JSON.parse(serializeMongoOps(ops));
    const controlDriver = await mongoControlDriver.create(replSet.getUri(dbName));
    try {
      const runner = new MongoMigrationRunner(
        new MongoControlAdapterImpl().createRunnerDependencies(controlDriver),
      );
      const destinationHash = 'authoring-test';
      const plan = {
        targetId: 'mongo',
        destination: { storageHash: destinationHash },
        operations: serialized,
      };
      const result = await runner.execute({
        plan,
        migrationEdges: buildFabricatedMigrationEdges(plan),
        // Synthetic-contract opt-out (paired with `strictVerification: false`):
        // these tests exercise the runner against hand-rolled migration ops,
        // not a real authored contract. Supply the minimum well-formed shape
        // `contractToMongoSchemaIR` reads (`storage.namespaces`) so the
        // verifier degrades to an empty-expected diff rather than crashing.
        destinationContract: {
          storage: {
            storageHash: destinationHash,
            namespaces: {
              [UNBOUND_NAMESPACE_ID]: {
                id: UNBOUND_NAMESPACE_ID,
                kind: 'mongo-namespace' as const,
                entries: { collection: {} },
              },
            },
          },
        } as unknown as MongoContract,
        policy: ALL_POLICY,
        frameworkComponents: [],
        strictVerification: false,
      });
      if (!result.ok) throw new Error(`Runner failed: ${result.failure.summary}`);
      return result.value;
    } finally {
      await controlDriver.close();
    }
  }

  describe('createCollection', () => {
    it('creates the collection in MongoDB', async () => {
      const ops = [createCollection('users')];
      const result = await runOps(ops);
      expect(result.operationsExecuted).toBe(1);

      const collections = await db.listCollections({ name: 'users' }).toArray();
      expect(collections).toHaveLength(1);
    });

    it('creates a collection with JSON schema validation', async () => {
      const ops = [
        createCollection('users', {
          validator: { $jsonSchema: { required: ['email'] } },
          validationLevel: 'strict',
          validationAction: 'error',
        }),
      ];
      await runOps(ops);

      const info = await db.listCollections({ name: 'users' }).toArray();
      const options = (info[0] as Record<string, unknown>)['options'] as Record<string, unknown>;
      expect(options['validator']).toEqual({ $jsonSchema: { required: ['email'] } });
    });
  });

  describe('createIndex', () => {
    it('creates an index on the collection', async () => {
      await db.createCollection('users');
      const ops = [createIndex('users', [{ field: 'email', direction: 1 as const }])];
      const result = await runOps(ops);
      expect(result.operationsExecuted).toBe(1);

      const indexes = await db.collection('users').listIndexes().toArray();
      const emailIndex = indexes.find(
        (idx) => idx['key'] && (idx['key'] as Record<string, number>)['email'] === 1,
      );
      expect(emailIndex).toBeDefined();
    });

    it('creates a unique index', async () => {
      await db.createCollection('users');
      const ops = [
        createIndex('users', [{ field: 'email', direction: 1 as const }], { unique: true }),
      ];
      await runOps(ops);

      const indexes = await db.collection('users').listIndexes().toArray();
      const emailIndex = indexes.find(
        (idx) => idx['key'] && (idx['key'] as Record<string, number>)['email'] === 1,
      );
      expect(emailIndex).toBeDefined();
      expect(emailIndex!['unique']).toBe(true);
    });
  });

  describe('dropIndex', () => {
    it('drops an existing index', async () => {
      await db.createCollection('users');
      await db.collection('users').createIndex({ email: 1 }, { name: 'email_1' });

      const ops = [dropIndex('users', [{ field: 'email', direction: 1 as const }])];
      const result = await runOps(ops);
      expect(result.operationsExecuted).toBe(1);

      const indexes = await db.collection('users').listIndexes().toArray();
      const emailIndex = indexes.find(
        (idx) => idx['key'] && (idx['key'] as Record<string, number>)['email'] === 1,
      );
      expect(emailIndex).toBeUndefined();
    });
  });

  describe('dropCollection', () => {
    it('drops an existing collection', async () => {
      await db.createCollection('users');
      const ops = [dropCollection('users')];
      const result = await runOps(ops);
      expect(result.operationsExecuted).toBe(1);

      const collections = await db.listCollections({ name: 'users' }).toArray();
      expect(collections).toHaveLength(0);
    });
  });

  describe('setValidation', () => {
    it('modifies collection validation', async () => {
      await db.createCollection('users');
      const ops = [
        setValidation('users', { required: ['email', 'name'] }, { validationLevel: 'strict' }),
      ];
      const result = await runOps(ops);
      expect(result.operationsExecuted).toBe(1);

      const info = await db.listCollections({ name: 'users' }).toArray();
      const options = (info[0] as Record<string, unknown>)['options'] as Record<string, unknown>;
      expect(options['validator']).toEqual({
        $jsonSchema: { required: ['email', 'name'] },
      });
    });
  });

  describe('round-trip serialization', () => {
    it('factory → JSON.stringify → deserializeMongoOps produces equivalent ops', () => {
      const original = [
        createCollection('users', {
          validator: { $jsonSchema: { required: ['email'] } },
          validationLevel: 'strict',
        }),
        createIndex('users', [{ field: 'email', direction: 1 as const }], { unique: true }),
        dropIndex('users', [{ field: 'email', direction: 1 as const }]),
        setValidation('users', { required: ['email', 'name'] }),
        dropCollection('users'),
      ];

      const json = JSON.stringify(original);
      const deserialized = deserializeMongoOps(JSON.parse(json));

      expect(deserialized).toHaveLength(5);
      for (let i = 0; i < original.length; i++) {
        expect(deserialized[i]!.id).toBe(original[i]!.id);
        expect(deserialized[i]!.label).toBe(original[i]!.label);
        expect(deserialized[i]!.operationClass).toBe(original[i]!.operationClass);
      }
    });

    it('deserialized ops execute successfully against the DB', async () => {
      const original = [
        createCollection('users'),
        createIndex('users', [{ field: 'email', direction: 1 as const }], { unique: true }),
      ];

      const json = JSON.stringify(original);
      const deserialized = deserializeMongoOps(JSON.parse(json));

      const result = await runOps(deserialized);
      expect(result.operationsExecuted).toBe(2);

      const collections = await db.listCollections({ name: 'users' }).toArray();
      expect(collections).toHaveLength(1);

      const indexes = await db.collection('users').listIndexes().toArray();
      const emailIndex = indexes.find(
        (idx) => idx['key'] && (idx['key'] as Record<string, number>)['email'] === 1,
      );
      expect(emailIndex).toBeDefined();
      expect(emailIndex!['unique']).toBe(true);
    });
  });

  describe('validatedCollection', () => {
    it('creates collection with schema validation and indexes', async () => {
      const ops = validatedCollection('users', { required: ['email', 'name'] }, [
        { keys: [{ field: 'email', direction: 1 }], unique: true },
        { keys: [{ field: 'name', direction: 1 }] },
      ]);
      const result = await runOps(ops);
      expect(result.operationsExecuted).toBe(3);

      const info = await db.listCollections({ name: 'users' }).toArray();
      expect(info).toHaveLength(1);
      const options = (info[0] as Record<string, unknown>)['options'] as Record<string, unknown>;
      expect(options['validator']).toEqual({
        $jsonSchema: { required: ['email', 'name'] },
      });

      const indexes = await db.collection('users').listIndexes().toArray();
      const emailIndex = indexes.find(
        (idx) => idx['key'] && (idx['key'] as Record<string, number>)['email'] === 1,
      );
      expect(emailIndex).toBeDefined();
      expect(emailIndex!['unique']).toBe(true);

      const nameIndex = indexes.find(
        (idx) => idx['key'] && (idx['key'] as Record<string, number>)['name'] === 1,
      );
      expect(nameIndex).toBeDefined();
    });

    it('round-trips through serialization and runs against the DB', async () => {
      const ops = validatedCollection('posts', { required: ['title'] }, [
        { keys: [{ field: 'title', direction: 1 }] },
      ]);

      const json = JSON.stringify(ops);
      const deserialized = deserializeMongoOps(JSON.parse(json));
      const result = await runOps(deserialized);
      expect(result.operationsExecuted).toBe(2);

      const collections = await db.listCollections({ name: 'posts' }).toArray();
      expect(collections).toHaveLength(1);
    });
  });

  describe('multi-step migration lifecycle', () => {
    it('applies a full create → modify → drop lifecycle', async () => {
      const step1 = [
        createCollection('users', {
          validator: { $jsonSchema: { required: ['email'] } },
          validationLevel: 'strict',
        }),
        createIndex('users', [{ field: 'email', direction: 1 as const }], { unique: true }),
      ];
      await runOps(step1);

      let collections = await db.listCollections({ name: 'users' }).toArray();
      expect(collections).toHaveLength(1);
      const indexes = await db.collection('users').listIndexes().toArray();
      expect(indexes.some((idx) => (idx['key'] as Record<string, number>)?.['email'] === 1)).toBe(
        true,
      );

      const step2 = [setValidation('users', { required: ['email', 'name'] })];

      const serialized2 = JSON.parse(serializeMongoOps(step2));
      const controlDriver2 = await mongoControlDriver.create(replSet.getUri(dbName));
      try {
        const runner = new MongoMigrationRunner(
          new MongoControlAdapterImpl().createRunnerDependencies(controlDriver2),
        );
        const destinationHashV2 = 'authoring-test-v2';
        const planV2 = {
          targetId: 'mongo',
          origin: { storageHash: 'authoring-test' },
          destination: { storageHash: destinationHashV2 },
          operations: serialized2,
        };
        const result2 = await runner.execute({
          plan: planV2,
          migrationEdges: buildFabricatedMigrationEdges(planV2),
          // Synthetic-contract opt-out: see comment at the top-level `runOps` call.
          destinationContract: {
            storage: {
              storageHash: destinationHashV2,
              namespaces: {
                [UNBOUND_NAMESPACE_ID]: {
                  id: UNBOUND_NAMESPACE_ID,
                  kind: 'mongo-namespace' as const,
                  entries: { collection: {} },
                },
              },
            },
          } as unknown as MongoContract,
          policy: ALL_POLICY,
          frameworkComponents: [],
          strictVerification: false,
        });
        expect(result2.ok).toBe(true);
      } finally {
        await controlDriver2.close();
      }

      const info = await db.listCollections({ name: 'users' }).toArray();
      const options = (info[0] as Record<string, unknown>)['options'] as Record<string, unknown>;
      expect(options['validator']).toEqual({
        $jsonSchema: { required: ['email', 'name'] },
      });

      const step3 = [
        dropIndex('users', [{ field: 'email', direction: 1 as const }]),
        dropCollection('users'),
      ];

      const serialized3 = JSON.parse(serializeMongoOps(step3));
      const controlDriver3 = await mongoControlDriver.create(replSet.getUri(dbName));
      try {
        const runner = new MongoMigrationRunner(
          new MongoControlAdapterImpl().createRunnerDependencies(controlDriver3),
        );
        const destinationHashV3 = 'authoring-test-v3';
        const planV3 = {
          targetId: 'mongo',
          origin: { storageHash: 'authoring-test-v2' },
          destination: { storageHash: destinationHashV3 },
          operations: serialized3,
        };
        const result3 = await runner.execute({
          plan: planV3,
          migrationEdges: buildFabricatedMigrationEdges(planV3),
          // Synthetic-contract opt-out: see comment at the top-level `runOps` call.
          destinationContract: {
            storage: {
              storageHash: destinationHashV3,
              namespaces: {
                [UNBOUND_NAMESPACE_ID]: {
                  id: UNBOUND_NAMESPACE_ID,
                  kind: 'mongo-namespace' as const,
                  entries: { collection: {} },
                },
              },
            },
          } as unknown as MongoContract,
          policy: ALL_POLICY,
          frameworkComponents: [],
          strictVerification: false,
        });
        expect(result3.ok).toBe(true);
      } finally {
        await controlDriver3.close();
      }

      collections = await db.listCollections({ name: 'users' }).toArray();
      expect(collections).toHaveLength(0);
    });
  });
});
