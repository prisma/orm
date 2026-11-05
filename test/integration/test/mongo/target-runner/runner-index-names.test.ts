import { introspectSchema, MongoControlAdapterImpl } from '@internal/adapter-mongo/control';
import { MongoControlDriver } from '@internal/driver-mongo/control';
import { verifyMongoSchema } from '@internal/family-mongo/schema-verify';
import { type MigrationPlan, planOriginOf } from '@internal/framework-components/control';
import {
  type AggregateMigrationEdgeRef,
  buildFabricatedMigrationEdge,
} from '@internal/migration-tools/aggregate';
import type { MongoContract, MongoIndexInput } from '@internal/mongo-contract';
import type { AnyMongoMigrationOperation } from '@internal/mongo-query-ast/control';
import type { MongoSchemaIR } from '@internal/mongo-schema-ir';
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

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  client = new MongoClient(replSet.getUri());
  await client.connect();
  db = client.db('runner_index_names');
}, timeouts.spinUpMongoMemoryServer);

afterAll(async () => {
  await client?.close();
  await replSet?.stop();
}, timeouts.spinUpMongoMemoryServer);

beforeEach(async () => {
  for (const collection of await db.listCollections().toArray()) {
    await db.dropCollection(collection['name'] as string);
  }
});

function contractWith(
  indexes: Record<string, readonly MongoIndexInput[]>,
  storageHash: string,
): MongoContract {
  return {
    storage: {
      storageHash,
      namespaces: {
        __unbound__: {
          id: '__unbound__',
          kind: 'mongo-namespace',
          entries: {
            collection: Object.fromEntries(
              Object.entries(indexes).map(([name, list]) => [name, { indexes: list }]),
            ),
          },
        },
      },
    },
  } as unknown as MongoContract;
}

function plan(contract: MongoContract, origin: MongoSchemaIR): MigrationPlan {
  const result = new MongoMigrationPlanner().plan({
    contract,
    schema: origin,
    policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
    fromContract: null,
    origin: planOriginOf(null),
    statements: [],
    frameworkComponents: [],
    snapshotsImportPath: '../../snapshots',
  });
  if (result.kind !== 'success') throw new Error('Planner failed unexpectedly');
  return result.plan;
}

function edges(migration: MigrationPlan): readonly AggregateMigrationEdgeRef[] {
  return [
    buildFabricatedMigrationEdge({
      currentMarkerStorageHash: migration.origin?.storageHash,
      destinationStorageHash: migration.destination.storageHash,
      operationCount: migration.operations.length,
    }),
  ];
}

async function apply(contract: MongoContract) {
  const migration = plan(contract, await introspectSchema(db));
  const serialized: MigrationPlan = {
    targetId: migration.targetId,
    operations: JSON.parse(serializeMongoOps(migration.operations as AnyMongoMigrationOperation[])),
    origin: migration.origin ?? null,
    destination: migration.destination,
  };
  const result = await new MongoMigrationRunner(
    controlAdapter.createRunnerDependencies(new MongoControlDriver(db, client)),
  ).execute({
    plan: serialized,
    migrationEdges: edges(migration),
    destinationContract: contract,
    policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
    frameworkComponents: [],
  });
  return {
    operationIds: migration.operations.map((op) => op.id),
    ok: result.ok,
  };
}

async function liveIndexes(collection: string) {
  const indexes = await db.collection(collection).listIndexes().toArray();
  return indexes
    .filter((index) => index['name'] !== '_id_')
    .map((index) => ({
      name: index['name'],
      key: index['key'],
      ...(index['unique'] ? { unique: true } : {}),
      ...(index['sparse'] ? { sparse: true } : {}),
      ...(index['partialFilterExpression']
        ? { partialFilterExpression: index['partialFilterExpression'] }
        : {}),
    }))
    .sort((a, b) => (String(a.name) < String(b.name) ? -1 : 1));
}

const email = [{ field: 'email', direction: 1 as const }];
const title = [{ field: 'title', direction: 1 as const }];

describe('MongoDB indexes by name, against a real database', () => {
  it(
    'creates in one migration indexes that share keys but not options, each under its own name',
    async () => {
      const contract = contractWith(
        {
          users: [
            { name: 'User_email_key', keys: email, unique: true },
            { name: 'User_email_idx', keys: email },
            { name: 'email_sparse', keys: email, sparse: true },
          ],
          tasks: [
            { name: 'bug_title', keys: title, partialFilterExpression: { type: 'bug' } },
            { name: 'feature_title', keys: title, partialFilterExpression: { type: 'feature' } },
          ],
        },
        'named',
      );

      const applied = await apply(contract);

      expect({
        applied,
        users: await liveIndexes('users'),
        tasks: await liveIndexes('tasks'),
        verify: verifyMongoSchema({
          contract,
          schema: await introspectSchema(db),
          strict: true,
          frameworkComponents: [],
        }).ok,
      }).toEqual({
        applied: {
          ok: true,
          operationIds: [
            'index.tasks.create(bug_title)',
            'index.tasks.create(feature_title)',
            'index.users.create(User_email_key)',
            'index.users.create(User_email_idx)',
            'index.users.create(email_sparse)',
          ],
        },
        users: [
          { name: 'User_email_idx', key: { email: 1 } },
          { name: 'User_email_key', key: { email: 1 }, unique: true },
          { name: 'email_sparse', key: { email: 1 }, sparse: true },
        ],
        tasks: [
          { name: 'bug_title', key: { title: 1 }, partialFilterExpression: { type: 'bug' } },
          {
            name: 'feature_title',
            key: { title: 1 },
            partialFilterExpression: { type: 'feature' },
          },
        ],
        verify: true,
      });
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'drops an index by the name the database holds it under, keeping one on the same keys',
    async () => {
      await db
        .collection('users')
        .createIndex({ email: 1 }, { name: 'User_email_key', unique: true });
      await db.collection('users').createIndex({ email: 1 }, { name: 'User_email_idx' });

      const applied = await apply(
        contractWith({ users: [{ name: 'User_email_idx', keys: email }] }, 'dropped'),
      );

      expect({ applied, users: await liveIndexes('users') }).toEqual({
        applied: { ok: true, operationIds: ['index.users.drop(User_email_key)'] },
        users: [{ name: 'User_email_idx', key: { email: 1 } }],
      });
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'renames an index by dropping it and creating it under the new name',
    async () => {
      await db.collection('users').createIndex({ email: 1 }, { unique: true });

      const applied = await apply(
        contractWith({ users: [{ name: 'User_email_key', keys: email, unique: true }] }, 'renamed'),
      );

      expect({ applied, users: await liveIndexes('users') }).toEqual({
        applied: {
          ok: true,
          operationIds: ['index.users.drop(email_1)', 'index.users.create(User_email_key)'],
        },
        users: [{ name: 'User_email_key', key: { email: 1 }, unique: true }],
      });
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'plans nothing for a contract with one index per key pattern against the names MongoDB gave',
    async () => {
      await db.collection('users').createIndex({ email: 1 }, { unique: true });
      await db.collection('users').createIndex({ lastName: 1, createdAt: -1 });
      const contract = contractWith(
        {
          users: [
            { name: 'email_1', keys: email, unique: true },
            {
              name: 'lastName_1_createdAt_-1',
              keys: [
                { field: 'lastName', direction: 1 },
                { field: 'createdAt', direction: -1 },
              ],
            },
          ],
        },
        'unchanged',
      );

      expect(plan(contract, await introspectSchema(db)).operations).toEqual([]);
    },
    timeouts.spinUpMongoMemoryServer,
  );
});
