import { MongoControlAdapterImpl } from '@internal/adapter-mongo/control';
import { MongoControlDriver } from '@internal/driver-mongo/control';
import type {
  MigrationOperationPolicy,
  MigrationPlan,
} from '@internal/framework-components/control';
import { buildFabricatedMigrationEdge } from '@internal/migration-tools/aggregate';
import { MongoCollection, type MongoContract } from '@internal/mongo-contract';
import type { AnyMongoMigrationOperation } from '@internal/mongo-query-ast/control';
import { MongoMigrationRunner, serializeMongoOps } from '@internal/target-mongo/control';
import {
  deleteDocuments,
  removeStoredValue,
  replaceStoredValue,
} from '@internal/target-mongo/migration';
import { timeouts } from '@repo/test-utils';
import { type Db, MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const controlAdapter = new MongoControlAdapterImpl();
const policy: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'],
};

let replSet: MongoMemoryReplSet;
let client: MongoClient;
let db: Db;
const dbName = 'runner_delete_documents_test';

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

const contract = {
  target: 'mongo',
  targetFamily: 'mongo',
  profileHash: 'p1',
  capabilities: {},
  extensions: {},
  meta: {},
  roots: {},
  models: {},
  domain: { namespaces: {} },
  storage: {
    storageHash: 'dest',
    namespaces: {
      __unbound__: {
        id: '__unbound__',
        kind: 'mongo-namespace',
        entries: { collection: { tasks: new MongoCollection({}) } },
      },
    },
  },
} as unknown as MongoContract;

async function run(operations: readonly AnyMongoMigrationOperation[]) {
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
    destinationContract: contract,
    policy,
    frameworkComponents: [],
  });
}

async function runAgain(operations: readonly AnyMongoMigrationOperation[]) {
  await controlAdapter.updateMarker(new MongoControlDriver(db, client), 'app', 'dest', {
    storageHash: 'origin',
    profileHash: 'p1',
  });
  return run(operations);
}

async function documents() {
  return db
    .collection('tasks')
    .find({}, { projection: { _id: 0 }, sort: { name: 1 } })
    .toArray();
}

function executed(result: Awaited<ReturnType<typeof run>>) {
  return result.ok ? result.value.operationsExecuted : result.failure;
}

const tasks = [
  { name: 'a', type: 'bug' },
  { name: 'b', type: 'epic' },
  { name: 'c', type: 'bug' },
  { name: 'd' },
  { name: 'e', type: ['bug'] },
];

const deleteBugs = deleteDocuments({ collection: 'tasks', filter: { type: 'bug' } });

describe('MongoMigrationRunner, deleteDocuments', () => {
  it(
    'deletes only the documents its filter selects, and skips on a re-run',
    async () => {
      await db.collection('tasks').insertMany(tasks);

      const first = executed(await run([deleteBugs]));
      const afterFirst = await documents();
      const rerun = executed(await runAgain([deleteBugs]));

      expect({ first, afterFirst, rerun, documents: await documents() }).toEqual({
        first: 1,
        afterFirst: [{ name: 'b', type: 'epic' }, { name: 'd' }],
        rerun: 0,
        documents: [{ name: 'b', type: 'epic' }, { name: 'd' }],
      });
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'skips on its postcheck in an empty collection',
    async () => {
      await db.createCollection('tasks');

      expect(executed(await run([deleteBugs]))).toBe(0);
      expect(await documents()).toEqual([]);
    },
    timeouts.spinUpMongoMemoryServer,
  );
});

describe('MongoMigrationRunner, a discriminator value replaced before a later operation stops', () => {
  it(
    'skips the replacement on the re-run once the documents are fixed, and finishes',
    async () => {
      await db.collection('tasks').insertMany([
        { name: 'a', type: 'bug', kind: 'old' },
        { name: 'b', type: 'epic', kind: 'x' },
      ]);
      const operations = [
        replaceStoredValue({
          collection: 'tasks',
          field: 'type',
          from: 'bug',
          to: { $literal: 'defect' },
        }),
        removeStoredValue({ collection: 'tasks', field: 'kind', value: 'old', required: true }),
      ];

      const stopped = await run(operations);
      const afterStop = await documents();
      await db.collection('tasks').updateOne({ name: 'a' }, { $set: { kind: 'x' } });
      const rerun = await run(operations);

      expect({
        stopped: stopped.ok ? 'applied' : stopped.failure.code,
        afterStop,
        rerun: rerun.ok ? 'applied' : rerun.failure.code,
        documents: await documents(),
      }).toEqual({
        stopped: 'MIGRATION.PRECHECK_FAILED',
        afterStop: [
          { name: 'a', type: 'defect', kind: 'old' },
          { name: 'b', type: 'epic', kind: 'x' },
        ],
        rerun: 'applied',
        documents: [
          { name: 'a', type: 'defect', kind: 'x' },
          { name: 'b', type: 'epic', kind: 'x' },
        ],
      });
    },
    timeouts.spinUpMongoMemoryServer,
  );
});
