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
import { removeStoredValue, replaceStoredValue } from '@internal/target-mongo/migration';
import { timeouts } from '@repo/test-utils';
import { type Db, MongoClient, ObjectId } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const controlAdapter = new MongoControlAdapterImpl();
const policy: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'],
};

let replSet: MongoMemoryReplSet;
let client: MongoClient;
let db: Db;
const dbName = 'runner_stored_values_test';

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
    status: 'archived',
    tags: ['archived', 'active', 'archived', null],
    profile: { status: 'archived', history: ['active', 'archived'] },
    addresses: [{ kind: 'archived' }, null, { kind: 'active' }, 'x', { kind: '$archived' }],
  },
  { name: 'Bo', status: 'active', tags: [], profile: null, addresses: [] },
  { name: 'Cy' },
  { name: 'Dee', status: '$archived', tags: 'archived', profile: 'x', addresses: 'x' },
];

describe('MongoMigrationRunner, replaceStoredValue', () => {
  const replacements = [
    replaceStoredValue({
      collection: 'users',
      field: 'status',
      from: 'archived',
      to: { $literal: '$retired' },
    }),
    replaceStoredValue({
      collection: 'users',
      field: 'tags',
      from: 'archived',
      to: { $literal: 'retired' },
    }),
    replaceStoredValue({
      collection: 'users',
      field: 'profile',
      path: '$.status',
      from: 'archived',
      to: { $literal: 'retired' },
    }),
    replaceStoredValue({
      collection: 'users',
      field: 'profile',
      path: '$.history',
      from: 'archived',
      to: { $literal: 'retired' },
    }),
    replaceStoredValue({
      collection: 'users',
      field: 'addresses',
      path: '$[*].kind',
      from: 'archived',
      to: { $literal: 'retired' },
    }),
  ];

  it(
    'replaces the value in a scalar, in each element of a list, and at paths inside the field, leaving every other value as it is',
    async () => {
      await db.collection('users').insertMany(users);

      expect(executed(await run(replacements))).toBe(5);
      expect(await documents()).toEqual([
        {
          name: 'Ada',
          status: '$retired',
          tags: ['retired', 'active', 'retired', null],
          profile: { status: 'retired', history: ['active', 'retired'] },
          addresses: [{ kind: 'retired' }, null, { kind: 'active' }, 'x', { kind: '$archived' }],
        },
        { name: 'Bo', status: 'active', tags: [], profile: null, addresses: [] },
        { name: 'Cy' },
        { name: 'Dee', status: '$archived', tags: 'retired', profile: 'x', addresses: 'x' },
      ]);
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'skips every replacement when run again after it finished',
    async () => {
      await db.collection('users').insertMany(users);
      expect(executed(await run(replacements))).toBe(5);
      const replaced = await documents();

      expect(executed(await runAgain(replacements))).toBe(0);
      expect(await documents()).toEqual(replaced);
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'matches a double by its number and writes the new value as a double',
    async () => {
      await db.collection('users').insertMany([
        { name: 'Ada', weight: 1.5, weights: [1.5, 2.5] },
        { name: 'Bo', weight: 2.5 },
      ]);
      await db
        .collection('users')
        .updateOne({ name: 'Bo' }, [{ $set: { weight: { $toDouble: 1 } } }]);

      const result = await run([
        replaceStoredValue({ collection: 'users', field: 'weight', from: 1, to: { $toDouble: 3 } }),
        replaceStoredValue({
          collection: 'users',
          field: 'weights',
          from: 2.5,
          to: { $toDouble: 4 },
        }),
      ]);

      expect(executed(result)).toBe(2);
      expect(
        await db
          .collection('users')
          .aggregate([
            {
              $project: {
                _id: 0,
                name: 1,
                weight: 1,
                weights: 1,
                type: { $type: '$weight' },
                elementTypes: {
                  $cond: [
                    { $isArray: '$weights' },
                    { $map: { input: '$weights', in: { $type: '$$this' } } },
                    null,
                  ],
                },
              },
            },
            { $sort: { name: 1 } },
          ])
          .toArray(),
      ).toEqual([
        {
          name: 'Ada',
          weight: 1.5,
          weights: [1.5, 4],
          type: 'double',
          elementTypes: ['double', 'double'],
        },
        { name: 'Bo', weight: 3, type: 'double', elementTypes: null },
      ]);
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'stores null where the replacement is null, in a root field and at a path inside it',
    async () => {
      await db
        .collection('users')
        .insertMany([{ name: 'Ada', status: 'archived', profile: { status: 'archived' } }]);

      const result = await run([
        replaceStoredValue({ collection: 'users', field: 'status', from: 'archived', to: null }),
        replaceStoredValue({
          collection: 'users',
          field: 'profile',
          path: '$.status',
          from: 'archived',
          to: null,
        }),
      ]);

      expect(executed(result)).toBe(2);
      expect(await documents()).toEqual([{ name: 'Ada', status: null, profile: { status: null } }]);
    },
    timeouts.spinUpMongoMemoryServer,
  );
});

describe('MongoMigrationRunner, removeStoredValue', () => {
  const removals = [
    removeStoredValue({ collection: 'users', field: 'status', value: 'archived' }),
    removeStoredValue({ collection: 'users', field: 'tags', value: 'archived' }),
    removeStoredValue({
      collection: 'users',
      field: 'profile',
      path: '$.status',
      value: 'archived',
    }),
    removeStoredValue({
      collection: 'users',
      field: 'profile',
      path: '$.history',
      value: 'archived',
    }),
    removeStoredValue({
      collection: 'users',
      field: 'addresses',
      path: '$[*].kind',
      value: 'archived',
    }),
  ];

  it(
    'unsets an optional field or key holding the value and pulls the value from lists',
    async () => {
      await db.collection('users').insertMany(users);

      expect(executed(await run(removals))).toBe(5);
      expect(await documents()).toEqual([
        {
          name: 'Ada',
          tags: ['active', null],
          profile: { history: ['active'] },
          addresses: [{}, null, { kind: 'active' }, 'x', { kind: '$archived' }],
        },
        { name: 'Bo', status: 'active', tags: [], profile: null, addresses: [] },
        { name: 'Cy' },
        { name: 'Dee', status: '$archived', profile: 'x', addresses: 'x' },
      ]);
      expect(executed(await runAgain(removals))).toBe(0);
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'pulls the value from a list of a required field',
    async () => {
      await db.collection('users').insertMany([{ name: 'Ada', tags: ['archived', 'active'] }]);

      const result = await run([
        removeStoredValue({
          collection: 'users',
          field: 'tags',
          value: 'archived',
          required: true,
        }),
      ]);

      expect(executed(result)).toBe(1);
      expect(await documents()).toEqual([{ name: 'Ada', tags: ['active'] }]);
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'stops when a required field holds the value, counting the documents and naming one _id, and removes nothing',
    async () => {
      const ada = new ObjectId('64b7f0a1c2d3e4f5a6b7c8d9');
      await db.collection('users').insertMany([
        { _id: ada, name: 'Ada', profile: { status: 'archived' } },
        { name: 'Bo', profile: { status: 'archived' } },
        { name: 'Cy', profile: { status: 'active' } },
      ]);

      const result = await run([
        removeStoredValue({
          collection: 'users',
          field: 'profile',
          path: '$.status',
          value: 'archived',
          required: true,
          enumValue: { enum: 'Status', member: 'ARCHIVED' },
        }),
      ]);

      if (result.ok) throw new Error('Expected the removal to stop at its precheck');
      const find =
        /Find them all with (db\.getCollection\("users"\)\.find\((.*)\)) in mongosh/.exec(
          result.failure.why ?? '',
        );
      expect({
        code: result.failure.code,
        message: result.failure.message,
        why: result.failure.why,
        rowsHoldingValue: result.failure.meta['rowsHoldingValue'],
        documents: await documents(),
      }).toEqual({
        code: 'MIGRATION.PRECHECK_FAILED',
        message:
          'Operation storedValue.users.profile.$.status.remove("archived") stopped: 2 documents in collection users hold value "archived" at path "$.status" in field profile, which is required',
        why: `One of them has _id ObjectId("64b7f0a1c2d3e4f5a6b7c8d9"). Find them all with ${find?.[1]} in mongosh. To keep them, add a new member to the enum and rename enum value "Status.ARCHIVED" to it instead of removing it, or change those documents to another value first. Once the documents are fixed, run the command again; operations that already ran are skipped. The failed apply changed nothing.`,
        rowsHoldingValue: [
          {
            enumValue: { enum: 'Status', member: 'ARCHIVED' },
            value: 'archived',
            rows: 2,
            operationIndex: 0,
            keepDataEdit: {
              remove:
                'removeStoredValue({ collection: "users", field: "profile", path: "$.status", value: "archived", required: true, enumValue: { enum: "Status", member: "ARCHIVED" } })',
              replaceWith:
                'replaceStoredValue({ collection: "users", field: "profile", path: "$.status", from: "archived", to: "<stored value>" })',
            },
          },
        ],
        documents: [
          { name: 'Ada', profile: { status: 'archived' } },
          { name: 'Bo', profile: { status: 'archived' } },
          { name: 'Cy', profile: { status: 'active' } },
        ],
      });
      expect(
        await db
          .collection('users')
          .find(JSON.parse(find?.[2] ?? '{}'), { projection: { _id: 0, name: 1 } })
          .toArray(),
      ).toEqual([{ name: 'Ada' }, { name: 'Bo' }]);
    },
    timeouts.spinUpMongoMemoryServer,
  );
});

describe('MongoMigrationRunner, a migration that stops after a replacement', () => {
  it(
    'skips the replacement on the re-run once the documents are fixed, and finishes',
    async () => {
      await db.collection('users').insertMany([
        { name: 'Ada', status: 'archived', kind: 'old' },
        { name: 'Bo', status: 'active', kind: 'x' },
      ]);
      const operations = [
        replaceStoredValue({
          collection: 'users',
          field: 'status',
          from: 'archived',
          to: { $literal: 'retired' },
        }),
        removeStoredValue({ collection: 'users', field: 'kind', value: 'old', required: true }),
      ];

      const stopped = await run(operations);
      const afterStop = await documents();
      await db.collection('users').updateOne({ name: 'Ada' }, { $set: { kind: 'x' } });
      const rerun = await run(operations);

      expect({
        stopped: stopped.ok ? 'applied' : stopped.failure.code,
        afterStop,
        rerun: executed(rerun),
        documents: await documents(),
      }).toEqual({
        stopped: 'MIGRATION.PRECHECK_FAILED',
        afterStop: [
          { name: 'Ada', status: 'retired', kind: 'old' },
          { name: 'Bo', status: 'active', kind: 'x' },
        ],
        rerun: 0,
        documents: [
          { name: 'Ada', status: 'retired', kind: 'x' },
          { name: 'Bo', status: 'active', kind: 'x' },
        ],
      });
    },
    timeouts.spinUpMongoMemoryServer,
  );
});

describe('MongoMigrationRunner, stored value operations on an empty collection', () => {
  it(
    'skips each one on its postcheck',
    async () => {
      await db.createCollection('users');

      const result = await run([
        replaceStoredValue({ collection: 'users', field: 'status', from: 'a', to: 'b' }),
        removeStoredValue({
          collection: 'users',
          field: 'profile',
          path: '$.status',
          value: 'a',
          required: true,
        }),
      ]);

      expect(executed(result)).toBe(0);
    },
    timeouts.spinUpMongoMemoryServer,
  );
});
