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
  castField,
  collMod,
  dataTransform,
  fillField,
  rawAggregate,
  rawUpdateMany,
} from '@internal/target-mongo/migration';
import { timeouts } from '@repo/test-utils';
import { type Db, MongoClient, ObjectId } from 'mongodb';
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

describe('MongoMigrationRunner, a fill of a list field', () => {
  it(
    'leaves a list holding null as it is, and fills only a missing or null list',
    async () => {
      await db.createCollection('users');
      await db
        .collection('users')
        .insertMany([
          { name: 'Ada', tags: ['a', null] },
          { name: 'Bo', tags: [null] },
          { name: 'Cy', tags: null },
          { name: 'Dee' },
        ]);

      const properties = { name: { bsonType: 'string' }, tags: { bsonType: 'array' } };
      const result = await run(
        [fillField({ collection: 'users', field: 'tags', value: [] }), validatorChange(properties)],
        usersContract(properties),
      );

      expect(result.ok ? result.value.operationsExecuted : result.failure).toBe(2);
      expect(
        await db
          .collection('users')
          .find({}, { projection: { _id: 0 }, sort: { name: 1 } })
          .toArray(),
      ).toEqual([
        { name: 'Ada', tags: ['a', null] },
        { name: 'Bo', tags: [null] },
        { name: 'Cy', tags: [] },
        { name: 'Dee', tags: [] },
      ]);
    },
    timeouts.spinUpMongoMemoryServer,
  );
});

function scaffold(name: string, filter: Record<string, unknown>, update: Record<string, unknown>) {
  return dataTransform(name, {
    check: { source: () => rawAggregate('users', [{ $match: filter }, { $limit: 1 }]) },
    run: () => rawUpdateMany('users', filter, [update], { bypassDocumentValidation: true }),
  });
}

describe('MongoMigrationRunner, every kind of rewrite on an empty collection', () => {
  it(
    'skips each rewrite on its postcheck before its precheck can ask for documents to change',
    async () => {
      await db.createCollection('users');
      const properties = {
        visits: { bsonType: 'long' },
        code: { bsonType: 'int' },
        score: { bsonType: 'int' },
        plan: { bsonType: 'string' },
        nickname: { bsonType: 'string' },
      };

      const result = await run(
        [
          castField({ collection: 'users', field: 'visits', from: ['int'], to: 'long' }),
          castField({ collection: 'users', field: 'code', from: ['string'], to: 'int' }),
          scaffold(
            'User.score',
            { $expr: { $not: { $in: [{ $type: '$score' }, ['missing', 'null', 'int']] } } },
            { $set: { score: { $toInt: '$score' } } },
          ),
          scaffold(
            'User.plan',
            { $expr: { $in: [{ $type: '$plan' }, ['missing', 'null']] } },
            { $set: { plan: 'free' } },
          ),
          fillField({ collection: 'users', field: 'nickname', value: { $literal: '' } }),
          validatorChange(properties),
        ],
        usersContract(properties),
      );

      expect({
        executed: result.ok ? result.value.operationsExecuted : result.failure,
        documents: await db.collection('users').countDocuments(),
      }).toEqual({ executed: 1, documents: 0 });
    },
    timeouts.spinUpMongoMemoryServer,
  );
});

describe('MongoMigrationRunner, a validator change whose documents a rewrite did not make fit', () => {
  it(
    'lists the operations of the apply that already changed the collection',
    async () => {
      await db.createCollection('users');
      await db.collection('users').insertMany([{ name: 'Ada' }]);
      const properties = { name: { bsonType: 'string' }, nickname: { bsonType: 'string' } };

      const result = await run(
        [
          fillField({ collection: 'users', field: 'nickname', value: 0 }),
          validatorChange(properties),
        ],
        usersContract(properties),
      );

      if (result.ok) throw new Error('Expected the validator change to stop');
      expect(result.failure.why).toContain(
        'These operations of this apply already changed collection users and stay applied: Fill field nickname in collection users where it is missing or null.',
      );
    },
    timeouts.spinUpMongoMemoryServer,
  );
});

describe('MongoMigrationRunner, a data transform whose update leaves documents its check still finds', () => {
  it(
    'counts them, names one _id and gives the query that finds them',
    async () => {
      await db.createCollection('users');
      const abc = new ObjectId('64b7f0c2a1b2c3d4e5f60718');
      await db.collection('users').insertMany([
        { _id: abc, name: 'Ada', age: 'abc' },
        { _id: new ObjectId('64b7f0c2a1b2c3d4e5f60719'), name: 'Bo', age: '7' },
      ]);
      const notInt = { $expr: { $not: { $in: [{ $type: '$age' }, ['missing', 'null', 'int']] } } };

      const result = await run(
        [
          scaffold('User.age', notInt, {
            $set: { age: { $convert: { input: '$age', to: 'int', onError: '$age' } } },
          }),
        ],
        usersContract({ name: { bsonType: 'string' }, age: { bsonType: 'int' } }),
      );

      if (result.ok) throw new Error('Expected the data transform to fail its check');
      const query = `db.getCollection("users").find(${JSON.stringify(notInt)})`;
      expect({
        code: result.failure.code,
        message: result.failure.message,
        why: result.failure.why,
        meta: result.failure.meta['documentsStillMatching'],
      }).toEqual({
        code: 'MIGRATION.POSTCHECK_FAILED',
        message:
          'Operation data_transform.User.age failed: after its update, 1 document in collection users still matches its check',
        why: `It has _id ObjectId("64b7f0c2a1b2c3d4e5f60718"). Find them all with ${query} in mongosh. Change the update in the migration's migration.ts so it changes them too, run the file with node, then run the command again; operations that already ran are skipped. The operations that ran before the failure stay applied.`,
        meta: {
          collection: 'users',
          documents: 1,
          documentId: 'ObjectId("64b7f0c2a1b2c3d4e5f60718")',
          query,
        },
      });
    },
    timeouts.spinUpMongoMemoryServer,
  );
});

describe('MongoMigrationRunner, a planner rewrite whose check still finds documents', () => {
  it(
    'says what happened without pointing to an update in migration.ts',
    async () => {
      await db.createCollection('users');
      await db
        .collection('users')
        .insertMany([{ _id: new ObjectId('64b7f0c2a1b2c3d4e5f60718'), name: 'Ada' }]);

      const result = await run(
        [fillField({ collection: 'users', field: 'nickname', value: { $literal: null } })],
        usersContract({ name: { bsonType: 'string' }, nickname: { bsonType: 'string' } }),
      );

      if (result.ok) throw new Error('Expected the fill to fail its check');
      expect({ message: result.failure.message, why: result.failure.why }).toEqual({
        message:
          'Operation field.users.nickname.fill failed: after its update, 1 document in collection users still matches its check',
        why: expect.stringMatching(
          /^It has _id ObjectId\("64b7f0c2a1b2c3d4e5f60718"\)\. Find them all with .* in mongosh\. The update this operation runs did not change them: another client may have written them during the apply, or the value it writes does not pass its own check\. Run the command again; operations that already ran are skipped\. If they are still found, change them by hand\./,
        ),
      });
      expect(result.failure.why).not.toContain('migration.ts');
    },
    timeouts.spinUpMongoMemoryServer,
  );
});
