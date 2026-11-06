import { MongoControlAdapterImpl } from '@internal/adapter-mongo/control';
import { asNamespaceId } from '@internal/contract/types';
import { MongoControlDriver } from '@internal/driver-mongo/control';
import type {
  MigrationOperationPolicy,
  MigrationPlan,
} from '@internal/framework-components/control';
import { buildFabricatedMigrationEdge } from '@internal/migration-tools/aggregate';
import { MongoCollection, type MongoContract } from '@internal/mongo-contract';
import type { AnyMongoMigrationOperation } from '@internal/mongo-query-ast/control';
import { MongoMigrationRunner, serializeMongoOps } from '@internal/target-mongo/control';
import { collMod, fillField } from '@internal/target-mongo/migration';
import { timeouts } from '@repo/test-utils';
import { type Db, MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const controlAdapter = new MongoControlAdapterImpl();
const policy: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'],
};

let replSet: MongoMemoryReplSet;
let client: MongoClient;
let db: Db;
const dbName = 'runner_field_fills_test';

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

function schemaWith(properties: Record<string, Record<string, unknown>>) {
  return {
    bsonType: 'object',
    required: ['_id', ...Object.keys(properties)],
    properties: { _id: { bsonType: 'objectId' }, ...properties },
    additionalProperties: false,
  };
}

function usersContract(properties: Record<string, Record<string, unknown>>): MongoContract {
  return {
    target: 'mongo',
    targetFamily: 'mongo',
    profileHash: 'p1',
    capabilities: {},
    extensions: {},
    meta: {},
    roots: {},
    domain: {
      namespaces: {
        __unbound__: {
          models: {
            User: {
              fields: Object.fromEntries(Object.keys(properties).map((field) => [field, {}])),
              relations: {},
              storage: {
                collection: 'users',
                fields: Object.fromEntries(
                  Object.keys(properties).map((field) => [field, { field }]),
                ),
              },
            },
          },
        },
      },
    },
    storage: {
      storageHash: 'dest',
      namespaces: {
        __unbound__: {
          id: '__unbound__',
          kind: 'mongo-namespace',
          entries: {
            collection: {
              users: new MongoCollection({
                validator: {
                  jsonSchema: schemaWith(properties),
                  validationLevel: 'strict',
                  validationAction: 'error',
                },
              }),
            },
          },
        },
      },
    },
  } as unknown as MongoContract;
}

function validatorChange(properties: Record<string, Record<string, unknown>>) {
  return collMod(
    'users',
    {
      validator: { $jsonSchema: schemaWith(properties) },
      validationLevel: 'strict',
      validationAction: 'error',
    },
    {
      id: 'validator.users.update',
      label: 'Update validator on users',
      operationClass: 'widening',
      checkDocuments: true,
    },
  );
}

async function run(operations: readonly AnyMongoMigrationOperation[], contract: MongoContract) {
  const plan: MigrationPlan = {
    targetId: 'mongo',
    operations: JSON.parse(serializeMongoOps(operations)),
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

describe('MongoMigrationRunner, a fill of a new required field', () => {
  it(
    'stores each temporary value with its BSON type where the field is missing or null, and leaves values alone',
    async () => {
      await db.createCollection('users');
      await db.collection('users').insertMany([
        { name: 'Ada' },
        {
          name: 'Bo',
          count: null,
          big: null,
          ratio: null,
          price: null,
          label: null,
          active: null,
          tags: null,
        },
        {
          name: 'Cy',
          count: 7,
          big: 8,
          ratio: 9,
          price: 10,
          label: 'x',
          active: true,
          tags: ['t'],
        },
      ]);
      const values = {
        count: { value: 0, bsonType: 'int' },
        big: { value: { $toLong: 0 }, bsonType: 'long' },
        ratio: { value: { $toDouble: 0 }, bsonType: 'double' },
        price: { value: { $toDecimal: '0' }, bsonType: 'decimal' },
        label: { value: { $literal: '' }, bsonType: 'string' },
        active: { value: false, bsonType: 'bool' },
        tags: { value: [], bsonType: 'array' },
      };
      const properties = {
        name: { bsonType: 'string' },
        ...Object.fromEntries(
          Object.entries(values).map(([field, { bsonType }]) => [
            field,
            bsonType === 'int' ? { bsonType: ['int'] } : { bsonType: ['int', bsonType] },
          ]),
        ),
      };

      const result = await run(
        [
          ...Object.entries(values).map(([field, { value }]) =>
            fillField({ collection: 'users', field, value }),
          ),
          validatorChange(properties),
        ],
        usersContract(properties),
      );

      expect(result.ok ? result.value.operationsExecuted : result.failure).toBe(8);
      const filled = await db
        .collection('users')
        .aggregate([
          { $sort: { name: 1 } },
          {
            $project: {
              _id: 0,
              name: 1,
              ...Object.fromEntries(
                Object.keys(values).map((field) => [field, { $type: `$${field}` }]),
              ),
            },
          },
        ])
        .toArray();
      const filledTypes = Object.fromEntries(
        Object.entries(values).map(([field, { bsonType }]) => [field, bsonType]),
      );
      expect(filled).toEqual([
        { name: 'Ada', ...filledTypes },
        { name: 'Bo', ...filledTypes },
        {
          name: 'Cy',
          count: 'int',
          big: 'int',
          ratio: 'int',
          price: 'int',
          label: 'string',
          active: 'bool',
          tags: 'array',
        },
      ]);
    },
    timeouts.spinUpMongoMemoryServer,
  );
});
