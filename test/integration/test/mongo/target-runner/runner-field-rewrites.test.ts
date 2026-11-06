import { MongoControlAdapterImpl } from '@internal/adapter-mongo/control';
import { MongoControlDriver } from '@internal/driver-mongo/control';
import type {
  MigrationOperationPolicy,
  MigrationPlan,
} from '@internal/framework-components/control';
import { buildFabricatedMigrationEdge } from '@internal/migration-tools/aggregate';
import { MongoCollection, type MongoContract } from '@internal/mongo-contract';
import type { AnyMongoMigrationOperation } from '@internal/mongo-query-ast/control';
import { RawUpdateManyCommand } from '@internal/mongo-query-ast/execution';
import { MongoMigrationRunner, serializeMongoOps } from '@internal/target-mongo/control';
import {
  collMod,
  createIndex,
  dataTransform,
  dropIndex,
  renameField,
  unsetField,
} from '@internal/target-mongo/migration';
import { timeouts } from '@repo/test-utils';
import { type Db, MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const controlAdapter = new MongoControlAdapterImpl();
const dbUpdatePolicy: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'],
};

let replSet: MongoMemoryReplSet;
let client: MongoClient;
let db: Db;
const dbName = 'runner_field_rewrites_test';

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
  await controlAdapter.initMarker(new MongoControlDriver(db, client), 'app', {
    storageHash: 'origin',
    profileHash: 'p1',
  });
});

function closedSchema(field: string) {
  return {
    bsonType: 'object',
    required: ['_id', field],
    properties: { _id: { bsonType: 'objectId' }, [field]: { bsonType: 'string' } },
    additionalProperties: false,
  };
}

function contractWith(collections: Record<string, MongoCollection>): MongoContract {
  return {
    target: 'mongo',
    targetFamily: 'mongo',
    profileHash: 'p1',
    capabilities: {},
    extensions: {},
    meta: {},
    roots: {},
    models: {},
    storage: {
      storageHash: 'dest',
      namespaces: {
        __unbound__: {
          id: '__unbound__',
          kind: 'mongo-namespace',
          entries: { collection: collections },
        },
      },
    },
  } as unknown as MongoContract;
}

const usersWithFullName = contractWith({
  users: new MongoCollection({
    indexes: [{ name: 'fullName_1', keys: [{ field: 'fullName', direction: 1 }], unique: true }],
    validator: {
      jsonSchema: closedSchema('fullName'),
      validationLevel: 'strict',
      validationAction: 'error',
    },
  }),
});

const renameNamePlan: readonly AnyMongoMigrationOperation[] = [
  dropIndex('users', [{ field: 'name', direction: 1 }]),
  renameField('users', 'name', 'fullName'),
  createIndex('users', [{ field: 'fullName', direction: 1 }], { unique: true }),
  collMod(
    'users',
    {
      validator: { $jsonSchema: closedSchema('fullName') },
      validationLevel: 'strict',
      validationAction: 'error',
    },
    { id: 'validator.users.update', label: 'Update validator on users' },
  ),
];

async function run(
  operations: readonly AnyMongoMigrationOperation[],
  destinationContract: MongoContract,
) {
  const plan: MigrationPlan = {
    targetId: 'mongo',
    operations: JSON.parse(serializeMongoOps(operations)),
    origin: { storageHash: 'origin' },
    destination: { storageHash: 'dest' },
  };
  const runner = new MongoMigrationRunner(
    controlAdapter.createRunnerDependencies(new MongoControlDriver(db, client)),
  );
  return runner.execute({
    plan,
    migrationEdges: [
      buildFabricatedMigrationEdge({
        currentMarkerStorageHash: 'origin',
        destinationStorageHash: 'dest',
        operationCount: operations.length,
      }),
    ],
    destinationContract,
    policy: dbUpdatePolicy,
    frameworkComponents: [],
  });
}

async function createClosedUsers(): Promise<void> {
  await db.createCollection('users', {
    validator: { $jsonSchema: closedSchema('name') },
    validationLevel: 'strict',
    validationAction: 'error',
  });
  await db.collection('users').createIndex({ name: 1 }, { unique: true, name: 'name_1' });
  await db.collection('users').insertMany([{ name: 'Ada' }, { name: 'Bo' }, { name: 'Cy' }]);
}

async function documents(collectionName: string) {
  return db
    .collection(collectionName)
    .find({}, { projection: { _id: 0 }, sort: { _id: 1 } })
    .toArray();
}

describe('MongoMigrationRunner - field rewrites', () => {
  it(
    'renames a field required by a closed validator and indexed uniquely, then rebuilds the index on the new name',
    async () => {
      await createClosedUsers();

      const result = await run(renameNamePlan, usersWithFullName);

      expect(result.ok ? result.value.operationsExecuted : result.failure).toBe(4);
      const indexes = await db.collection('users').indexes();
      expect({
        documents: await documents('users'),
        indexes: indexes.map(({ name, key, unique }) => ({ name, key, unique })),
      }).toEqual({
        documents: [{ fullName: 'Ada' }, { fullName: 'Bo' }, { fullName: 'Cy' }],
        indexes: [
          { name: '_id_', key: { _id: 1 }, unique: undefined },
          { name: 'fullName_1', key: { fullName: 1 }, unique: true },
        ],
      });
      await expect(
        db.collection('users').updateOne({ fullName: 'Ada' }, { $set: { fullName: 'Ada L.' } }),
      ).resolves.toMatchObject({ modifiedCount: 1 });
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'skips every operation when run again after success',
    async () => {
      await createClosedUsers();
      const first = await run(renameNamePlan, usersWithFullName);
      expect(first.ok).toBe(true);
      await controlAdapter.updateMarker(new MongoControlDriver(db, client), 'app', 'dest', {
        storageHash: 'origin',
        profileHash: 'p1',
      });

      const second = await run(renameNamePlan, usersWithFullName);

      expect(second.ok ? second.value.operationsExecuted : second.failure).toBe(0);
      expect(await documents('users')).toEqual([
        { fullName: 'Ada' },
        { fullName: 'Bo' },
        { fullName: 'Cy' },
      ]);
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'fails at the before-check and changes nothing when a document already holds the new name',
    async () => {
      await db.collection('users').insertMany([{ name: 'Ada' }, { name: 'Bo', fullName: 'Bo B.' }]);

      const result = await run([renameField('users', 'name', 'fullName')], usersWithFullName);

      expect(result.ok ? result.value : result.failure.code).toBe('MIGRATION.PRECHECK_FAILED');
      expect(await documents('users')).toEqual([
        { name: 'Ada' },
        { name: 'Bo', fullName: 'Bo B.' },
      ]);
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'finishes the plan once the documents its before-check names are fixed as its message says',
    async () => {
      await createClosedUsers();
      await db
        .collection('users')
        .insertOne({ name: 'Dee', fullName: 'Dee D.' }, { bypassDocumentValidation: true });

      const stopped = await run(renameNamePlan, usersWithFullName);
      if (stopped.ok) throw new Error('Expected the rename to stop at its before-check');
      const printedFind = /db\.getCollection\("users"\)\.find\((.*)\) in mongosh/.exec(
        stopped.failure.why ?? '',
      );
      const found = await db
        .collection('users')
        .find(JSON.parse(printedFind?.[1] ?? 'null'), { projection: { _id: 0 } })
        .toArray();
      expect({
        message: stopped.failure.message,
        found,
        indexes: (await db.collection('users').indexes()).map(({ name }) => name),
      }).toEqual({
        message:
          'Operation field.users.name.rename(fullName) stopped: some documents in collection users already hold fullName as well as name',
        found: [{ name: 'Dee', fullName: 'Dee D.' }],
        indexes: ['_id_'],
      });

      await db.collection('users').updateMany(
        JSON.parse(printedFind?.[1] ?? 'null'),
        { $unset: { fullName: '' } },
        {
          bypassDocumentValidation: true,
        },
      );
      const finished = await run(renameNamePlan, usersWithFullName);

      expect(finished.ok ? finished.value.operationsExecuted : finished.failure).toBe(3);
      expect({
        documents: await documents('users'),
        indexes: (await db.collection('users').indexes()).map(({ name }) => name),
      }).toEqual({
        documents: [
          { fullName: 'Ada' },
          { fullName: 'Bo' },
          { fullName: 'Cy' },
          { fullName: 'Dee' },
        ],
        indexes: ['_id_', 'fullName_1'],
      });
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'finishes a rename that stopped part way, where some documents already hold only the new name',
    async () => {
      await db.collection('users').insertMany([{ fullName: 'a' }, { name: 'b' }]);

      const result = await run(
        [renameField('users', 'name', 'fullName')],
        contractWith({ users: new MongoCollection({}) }),
      );

      expect(result.ok ? result.value.operationsExecuted : result.failure).toBe(1);
      expect(await documents('users')).toEqual([{ fullName: 'a' }, { fullName: 'b' }]);
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'removes a field from every document that holds it, past a closed validator',
    async () => {
      await db.createCollection('users', {
        validator: { $jsonSchema: closedSchema('name') },
        validationLevel: 'strict',
        validationAction: 'error',
      });
      await db.collection('users').insertMany([{ name: 'Ada' }, { name: 'Bo' }]);

      const result = await run(
        [unsetField('users', 'name')],
        contractWith({
          users: new MongoCollection({
            validator: {
              jsonSchema: closedSchema('name'),
              validationLevel: 'strict',
              validationAction: 'error',
            },
          }),
        }),
      );

      expect(result.ok ? result.value.operationsExecuted : result.failure).toBe(1);
      expect(await documents('users')).toEqual([{}, {}]);
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'limits both rewrites to documents that match the filter',
    async () => {
      await db.collection('posts').insertMany([
        { type: 'bug', title: 'Crash', score: 1 },
        { type: 'feature', title: 'Dark mode', score: 2 },
      ]);

      const result = await run(
        [
          renameField('posts', 'title', 'headline', { filter: { type: 'bug' } }),
          unsetField('posts', 'score', { filter: { type: 'bug' } }),
        ],
        contractWith({ posts: new MongoCollection({}) }),
      );

      expect(result.ok ? result.value.operationsExecuted : result.failure).toBe(2);
      expect(await documents('posts')).toEqual([
        { type: 'bug', headline: 'Crash' },
        { type: 'feature', title: 'Dark mode', score: 2 },
      ]);
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'refuses a data transform under the same policy',
    async () => {
      await db.collection('posts').insertOne({ title: 'Crash' });
      const backfill = dataTransform('backfill-status', {
        run: () => ({
          collection: 'posts',
          command: new RawUpdateManyCommand('posts', {}, { $set: { status: 'open' } }),
          meta: { target: 'mongo', storageHash: 'dest', lane: 'mongo-raw' },
        }),
      });

      const result = await run([backfill], contractWith({ posts: new MongoCollection({}) }));

      expect(result.ok ? result.value : result.failure.code).toBe('MIGRATION.POLICY_VIOLATION');
      expect(await documents('posts')).toEqual([{ title: 'Crash' }]);
    },
    timeouts.spinUpMongoMemoryServer,
  );
});
