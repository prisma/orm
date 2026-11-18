import { MongoControlAdapterImpl } from '@internal/adapter-mongo/control';
import { MongoControlDriver } from '@internal/driver-mongo/control';
import type { MigrationPlan } from '@internal/framework-components/control';
import { buildFabricatedMigrationEdge } from '@internal/migration-tools/aggregate';
import { MongoCollection, type MongoContract } from '@internal/mongo-contract';
import { MongoMigrationRunner, serializeMongoOps } from '@internal/target-mongo/control';
import { renameCollection } from '@internal/target-mongo/migration';
import { timeouts } from '@repo/test-utils';
import { type Db, MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const controlAdapter = new MongoControlAdapterImpl();

let replSet: MongoMemoryReplSet;
let client: MongoClient;
let db: Db;
const dbName = 'runner_rename_collection_test';

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

const CLOSED_PROFILE_SCHEMA = {
  bsonType: 'object',
  required: ['_id', 'email'],
  properties: {
    _id: { bsonType: 'objectId' },
    email: { bsonType: 'string' },
  },
  additionalProperties: false,
} as const;

function usersContract(): MongoContract {
  const users = new MongoCollection({
    indexes: [{ name: 'email_1', keys: [{ field: 'email', direction: 1 }], unique: true }],
    validator: {
      jsonSchema: { ...CLOSED_PROFILE_SCHEMA },
      validationLevel: 'strict',
      validationAction: 'error',
    },
  });
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
          entries: { collection: { users } },
        },
      },
    },
  } as unknown as MongoContract;
}

const renamePlan: MigrationPlan = {
  targetId: 'mongo',
  operations: JSON.parse(serializeMongoOps([renameCollection('profiles', 'users')])),
  origin: { storageHash: 'origin' },
  destination: { storageHash: 'dest' },
};

async function createProfiles(): Promise<void> {
  await db.createCollection('profiles', {
    validator: { $jsonSchema: CLOSED_PROFILE_SCHEMA },
    validationLevel: 'strict',
    validationAction: 'error',
  });
  await db.collection('profiles').createIndex({ email: 1 }, { unique: true, name: 'email_1' });
  await db
    .collection('profiles')
    .insertMany([{ email: 'ada@example.com' }, { email: 'bo@example.com' }]);
  await controlAdapter.initMarker(new MongoControlDriver(db, client), 'app', {
    storageHash: 'origin',
    profileHash: 'p1',
  });
}

async function runRename() {
  const runner = new MongoMigrationRunner(
    controlAdapter.createRunnerDependencies(new MongoControlDriver(db, client)),
  );
  return runner.execute({
    plan: renamePlan,
    migrationEdges: [
      buildFabricatedMigrationEdge({
        currentMarkerStorageHash: 'origin',
        destinationStorageHash: 'dest',
        operationCount: 1,
      }),
    ],
    destinationContract: usersContract(),
    policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
    frameworkComponents: [],
  });
}

async function collectionNames(): Promise<string[]> {
  const collections = await db.listCollections({ name: { $in: ['profiles', 'users'] } }).toArray();
  return collections.map((c) => c.name).sort();
}

async function emails(collectionName: string): Promise<string[]> {
  const docs = await db.collection(collectionName).find().toArray();
  return docs.map((d) => String(d['email'])).sort();
}

describe('MongoMigrationRunner - renameCollection', () => {
  it(
    'renames a collection and keeps its documents, unique index and closed validator',
    async () => {
      await createProfiles();

      const result = await runRename();

      expect(result.ok ? result.value.operationsExecuted : result.failure).toBe(1);
      const [users] = await db.listCollections({ name: 'users' }, { nameOnly: false }).toArray();
      const indexes = await db.collection('users').indexes();
      expect({
        names: await collectionNames(),
        emails: await emails('users'),
        validator: users && 'options' in users ? users.options?.['validator'] : undefined,
        emailIndex: indexes.find((i) => i.name === 'email_1'),
      }).toEqual({
        names: ['users'],
        emails: ['ada@example.com', 'bo@example.com'],
        validator: { $jsonSchema: CLOSED_PROFILE_SCHEMA },
        emailIndex: expect.objectContaining({ key: { email: 1 }, unique: true }),
      });
      await expect(db.collection('users').insertOne({ email: 'ada@example.com' })).rejects.toThrow(
        /duplicate key/,
      );
      await expect(
        db.collection('users').insertOne({ email: 'cy@example.com', undeclared: true }),
      ).rejects.toThrow(/Document failed validation/);
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'skips the rename through its after-check when run again',
    async () => {
      await createProfiles();
      const first = await runRename();
      expect(first.ok).toBe(true);
      const reset = await controlAdapter.updateMarker(
        new MongoControlDriver(db, client),
        'app',
        'dest',
        { storageHash: 'origin', profileHash: 'p1' },
      );
      expect(reset).toBe(true);

      const second = await runRename();

      expect(second.ok ? second.value.operationsExecuted : second.failure).toBe(0);
      expect({ names: await collectionNames(), emails: await emails('users') }).toEqual({
        names: ['users'],
        emails: ['ada@example.com', 'bo@example.com'],
      });
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'fails at the before-check and changes nothing when the target collection exists',
    async () => {
      await createProfiles();
      await db.collection('users').insertOne({ email: 'already@example.com' });

      const result = await runRename();

      expect(
        result.ok ? result.value : { code: result.failure.code, message: result.failure.message },
      ).toEqual({
        code: 'MIGRATION.PRECHECK_FAILED',
        message:
          'Operation collection.profiles.rename(users) stopped: collection users already exists, so collection profiles cannot be renamed to it',
      });
      expect({
        names: await collectionNames(),
        profiles: await emails('profiles'),
        users: await emails('users'),
      }).toEqual({
        names: ['profiles', 'users'],
        profiles: ['ada@example.com', 'bo@example.com'],
        users: ['already@example.com'],
      });
    },
    timeouts.spinUpMongoMemoryServer,
  );
});
