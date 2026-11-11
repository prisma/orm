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
import { fillStoredKey, removeStoredKey, renameStoredKey } from '@internal/target-mongo/migration';
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
const dbName = 'runner_stored_keys_test';

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
  storage: {
    storageHash: 'dest',
    namespaces: {
      __unbound__: {
        id: '__unbound__',
        kind: 'mongo-namespace',
        entries: { collection: { users: new MongoCollection({}) } },
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
    .collection('users')
    .find({}, { projection: { _id: 0 }, sort: { name: 1 } })
    .toArray();
}

function executed(result: Awaited<ReturnType<typeof run>>) {
  return result.ok ? result.value.operationsExecuted : result.failure;
}

const users = [
  {
    name: 'Ada',
    address: { street: '$main', zip: null },
    addresses: [{ street: '1 Main', zip: '1' }, null, { street: '$dollar', zip: null }, 'x'],
    profile: { addresses: [{ street: '2 Side' }, null], nickname: 'A' },
  },
  { name: 'Bo', address: null, addresses: [], profile: { addresses: [] } },
  { name: 'Cy' },
  { name: 'Dee', address: { line1: 'done' }, addresses: [{ line1: 'done' }], profile: null },
];

const renames = [
  renameStoredKey({ collection: 'users', field: 'address', path: '$.street', to: 'line1' }),
  renameStoredKey({ collection: 'users', field: 'addresses', path: '$[*].street', to: 'line1' }),
  renameStoredKey({
    collection: 'users',
    field: 'profile',
    path: '$.addresses[*].street',
    to: 'line1',
  }),
];

describe('MongoMigrationRunner, renameStoredKey', () => {
  it(
    'renames the key in every object at the path, and leaves null, missing, empty and non-object values as they are',
    async () => {
      await db.collection('users').insertMany(users);

      const result = await run(renames);

      expect(executed(result)).toBe(3);
      expect(await documents()).toEqual([
        {
          name: 'Ada',
          address: { line1: '$main', zip: null },
          addresses: [{ line1: '1 Main', zip: '1' }, null, { line1: '$dollar', zip: null }, 'x'],
          profile: { addresses: [{ line1: '2 Side' }, null], nickname: 'A' },
        },
        { name: 'Bo', address: null, addresses: [], profile: { addresses: [] } },
        { name: 'Cy' },
        { name: 'Dee', address: { line1: 'done' }, addresses: [{ line1: 'done' }], profile: null },
      ]);
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'renames through a list of objects that hold lists, leaving an element without its inner list as it is',
    async () => {
      await db.collection('users').insertMany([
        {
          name: 'Ada',
          orders: [{ lines: [{ sku: 'a' }, null] }, {}, { lines: null }, { lines: [] }],
        },
      ]);

      const result = await run([
        renameStoredKey({
          collection: 'users',
          field: 'orders',
          path: '$[*].lines[*].sku',
          to: 'code',
        }),
      ]);

      expect(executed(result)).toBe(1);
      expect(await documents()).toEqual([
        {
          name: 'Ada',
          orders: [{ lines: [{ code: 'a' }, null] }, {}, { lines: null }, { lines: [] }],
        },
      ]);
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'skips every rename when run again after it finished',
    async () => {
      await db.collection('users').insertMany(users);
      expect(executed(await run(renames))).toBe(3);
      const renamed = await documents();

      expect(executed(await runAgain(renames))).toBe(0);
      expect(await documents()).toEqual(renamed);
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'stops at its precheck when an object holds both keys, says how to find it, and renames nothing',
    async () => {
      await db.collection('users').insertMany([
        { name: 'Ada', addresses: [{ street: 'a' }] },
        { name: 'Bo', addresses: [{ street: 'b' }, { street: 'c', line1: 'c' }] },
      ]);
      const [, rename] = renames;
      if (rename === undefined) throw new Error('Expected the list rename');

      const result = await run([rename]);

      if (result.ok) throw new Error('Expected the rename to stop at its precheck');
      const find = /Find them with (db\.getCollection\("users"\)\.find\((.*)\)) in mongosh/.exec(
        result.failure.why ?? '',
      );
      expect({
        code: result.failure.code,
        message: result.failure.message,
        why: result.failure.why,
        documents: await documents(),
      }).toEqual({
        code: 'MIGRATION.PRECHECK_FAILED',
        message:
          'Operation storedKey.users.addresses.$[*].street.rename(line1) stopped: some objects at path "$[*].street" in field addresses of collection users already hold key "line1" as well as key "street"',
        why: `Renaming key "street" to "line1" would overwrite their "line1". Find them with ${find?.[1]} in mongosh, and remove one of the two keys from each of those objects. Nothing was renamed. Once the documents are fixed, run the command again; operations that already ran are skipped. The failed apply changed nothing.`,
        documents: [
          { name: 'Ada', addresses: [{ street: 'a' }] },
          { name: 'Bo', addresses: [{ street: 'b' }, { street: 'c', line1: 'c' }] },
        ],
      });
      expect(
        await db
          .collection('users')
          .find(JSON.parse(find?.[2] ?? '{}'), { projection: { _id: 0, name: 1 } })
          .toArray(),
      ).toEqual([{ name: 'Bo' }]);
    },
    timeouts.spinUpMongoMemoryServer,
  );
});

describe('MongoMigrationRunner, removeStoredKey', () => {
  it(
    'removes the key, null or not, from every object at the path, and leaves other values as they are',
    async () => {
      await db.collection('users').insertMany(users);

      const result = await run([
        removeStoredKey({ collection: 'users', field: 'address', path: '$.zip' }),
        removeStoredKey({ collection: 'users', field: 'addresses', path: '$[*].zip' }),
        removeStoredKey({ collection: 'users', field: 'profile', path: '$.addresses[*].street' }),
      ]);

      expect(executed(result)).toBe(3);
      expect(await documents()).toEqual([
        {
          name: 'Ada',
          address: { street: '$main' },
          addresses: [{ street: '1 Main' }, null, { street: '$dollar' }, 'x'],
          profile: { addresses: [{}, null], nickname: 'A' },
        },
        { name: 'Bo', address: null, addresses: [], profile: { addresses: [] } },
        { name: 'Cy' },
        { name: 'Dee', address: { line1: 'done' }, addresses: [{ line1: 'done' }], profile: null },
      ]);
      const again = await runAgain([
        removeStoredKey({ collection: 'users', field: 'addresses', path: '$[*].zip' }),
      ]);
      expect(executed(again)).toBe(0);
    },
    timeouts.spinUpMongoMemoryServer,
  );
});

describe('MongoMigrationRunner, fillStoredKey', () => {
  it(
    'sets the key where an object lacks it or holds null, storing the value with its type and a "$" value as a literal',
    async () => {
      await db.collection('users').insertMany(users);

      const result = await run([
        fillStoredKey({
          collection: 'users',
          field: 'address',
          path: '$.zip',
          value: { $toLong: 0 },
        }),
        fillStoredKey({
          collection: 'users',
          field: 'addresses',
          path: '$[*].zip',
          value: { $literal: '$none' },
        }),
        fillStoredKey({
          collection: 'users',
          field: 'profile',
          path: '$.addresses[*].city',
          value: { $literal: '' },
        }),
      ]);

      expect(executed(result)).toBe(3);
      expect(await documents()).toEqual([
        {
          name: 'Ada',
          address: { street: '$main', zip: 0 },
          addresses: [
            { street: '1 Main', zip: '1' },
            null,
            { street: '$dollar', zip: '$none' },
            'x',
          ],
          profile: { addresses: [{ street: '2 Side', city: '' }, null], nickname: 'A' },
        },
        { name: 'Bo', address: null, addresses: [], profile: { addresses: [] } },
        { name: 'Cy' },
        {
          name: 'Dee',
          address: { line1: 'done', zip: 0 },
          addresses: [{ line1: 'done', zip: '$none' }],
          profile: null,
        },
      ]);
      expect(
        await db
          .collection('users')
          .aggregate([
            { $match: { 'address.zip': { $exists: true } } },
            { $project: { _id: 0, name: 1, type: { $type: '$address.zip' } } },
            { $sort: { name: 1 } },
          ])
          .toArray(),
      ).toEqual([
        { name: 'Ada', type: 'long' },
        { name: 'Dee', type: 'long' },
      ]);
    },
    timeouts.spinUpMongoMemoryServer,
  );
});

describe('MongoMigrationRunner, stored key operations on an empty collection', () => {
  it(
    'skips each one on its postcheck',
    async () => {
      await db.createCollection('users');

      const result = await run([
        ...renames,
        removeStoredKey({ collection: 'users', field: 'addresses', path: '$[*].zip' }),
        fillStoredKey({ collection: 'users', field: 'addresses', path: '$[*].zip', value: '' }),
      ]);

      expect(executed(result)).toBe(0);
    },
    timeouts.spinUpMongoMemoryServer,
  );
});
