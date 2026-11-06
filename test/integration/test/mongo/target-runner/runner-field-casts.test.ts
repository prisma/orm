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
import { castField, collMod } from '@internal/target-mongo/migration';
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
const dbName = 'runner_field_casts_test';

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

async function types(field: string): Promise<unknown[]> {
  const documents = await db
    .collection('users')
    .aggregate([{ $sort: { name: 1 } }, { $project: { _id: 0, type: { $type: `$${field}` } } }])
    .toArray();
  return documents.map((document) => document['type']);
}

describe('MongoMigrationRunner, a cast of a field', () => {
  it(
    'casts Int to BigInt in every document, and the validator change then finds every document fits',
    async () => {
      await db.createCollection('users');
      await db.collection('users').insertMany([
        { name: 'Ada', age: 36 },
        { name: 'Bo', age: 41 },
      ]);
      const contract = usersContract({ name: { bsonType: 'string' }, age: { bsonType: 'long' } });

      const result = await run(
        [
          castField('users', 'age', { from: ['int'], to: 'long' }),
          validatorChange({ name: { bsonType: 'string' }, age: { bsonType: 'long' } }),
        ],
        contract,
      );

      expect(result.ok ? result.value.operationsExecuted : result.failure).toBe(2);
      expect(await types('age')).toEqual(['long', 'long']);
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'casts "42" to 42 and fails on "abc", naming the field and --convert',
    async () => {
      await db.createCollection('users');
      await db.collection('users').insertMany([
        { name: 'Ada', age: '42' },
        { name: 'Bo', age: 'abc' },
      ]);
      const contract = usersContract({ name: { bsonType: 'string' }, age: { bsonType: 'int' } });

      const result = await run(
        [
          castField('users', 'age', { from: ['string'], to: 'int' }),
          validatorChange({ name: { bsonType: 'string' }, age: { bsonType: 'int' } }),
        ],
        contract,
      );

      if (result.ok) throw new Error('Expected the cast to fail on "abc"');
      expect({
        code: result.failure.code,
        message: result.failure.message,
        why: result.failure.why,
        meta: result.failure.meta,
      }).toEqual({
        code: 'MIGRATION.EXECUTION_FAILED',
        message:
          'Operation field.users.age.cast(int) failed: a value of field "User.age" in collection users cannot be cast to int',
        why: `MongoDB's $convert met a value of field "User.age" it cannot cast to int: Failed to parse number 'abc' in $convert with no onError value: Did not consume whole string. Documents cast before that value stay cast, and a re-run casts the rest. The operations that ran before the failure stay applied.`,
        meta: {
          operationId: 'field.users.age.cast(int)',
          mongoCode: 241,
          failedTypeChange: {
            field: {
              kind: 'field',
              namespaceId: asNamespaceId('__unbound__'),
              model: 'User',
              field: 'age',
            },
            by: 'cast',
            reason: 'value',
            operationIndex: 0,
          },
          databaseUnchanged: false,
        },
      });
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'skips a finished cast on a re-run once the value it failed on is fixed',
    async () => {
      await db.createCollection('users');
      await db.collection('users').insertMany([
        { name: 'Ada', age: 36, code: '7' },
        { name: 'Bo', age: 41, code: 'x' },
      ]);
      const properties = {
        name: { bsonType: 'string' },
        age: { bsonType: 'long' },
        code: { bsonType: 'int' },
      };
      const operations = [
        castField('users', 'age', { from: ['int'], to: 'long' }),
        castField('users', 'code', { from: ['string'], to: 'int' }),
        validatorChange(properties),
      ];
      const contract = usersContract(properties);

      const stopped = await run(operations, contract);
      await db.collection('users').updateOne({ code: 'x' }, { $set: { code: '8' } });
      const finished = await run(operations, contract);

      expect({
        stopped: stopped.ok ? 'ok' : stopped.failure.code,
        finished: finished.ok ? finished.value.operationsExecuted : finished.failure,
        codes: await types('code'),
        ages: await types('age'),
      }).toEqual({
        stopped: 'MIGRATION.EXECUTION_FAILED',
        finished: 2,
        codes: ['int', 'int'],
        ages: ['long', 'long'],
      });
    },
    timeouts.spinUpMongoMemoryServer,
  );
});
