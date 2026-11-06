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
import { collMod, createIndex, setValidation } from '@internal/target-mongo/migration';
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
const dbName = 'runner_validator_document_check_test';

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

const schemaWithPlan = {
  bsonType: 'object',
  required: ['_id', 'name', 'plan'],
  properties: {
    _id: { bsonType: 'objectId' },
    name: { bsonType: 'string' },
    plan: { bsonType: 'string' },
  },
  additionalProperties: false,
};

const BY_HAND =
  'The old validator rejects a document changed to the new shape unless the update skips document validation: change them with a dataTransform in migration.ts, or in mongosh with an update command that sets bypassDocumentValidation: true, such as db.runCommand({ update: "users", updates: [{ q: { _id: <id> }, u: { $set: { <field>: <value> } } }], bypassDocumentValidation: true }).';
const CHECK_DOCUMENTS_FALSE =
  'Under db migrate you can instead apply the validator over them: set checkDocuments to false on this operation in that migration.ts, remove the checkDocuments call before the rewrites if the file has one, run the file with node, and run db migrate again. db update writes no migration.ts, so there fix the documents first.';
const NO_VALIDATOR_BY_HAND =
  'Change them with a dataTransform in migration.ts, or with an update in mongosh.';

const usersWithPlan = {
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
            fields: { name: {}, plan: {} },
            relations: {},
            storage: {
              collection: 'users',
              fields: { name: { field: 'name' }, plan: { field: 'plan' } },
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
                jsonSchema: schemaWithPlan,
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

function addPlanValidator(checkDocuments: boolean | undefined): AnyMongoMigrationOperation {
  return collMod(
    'users',
    {
      validator: { $jsonSchema: schemaWithPlan },
      validationLevel: 'strict',
      validationAction: 'error',
    },
    {
      id: 'validator.users.update',
      label: 'Update validator on users',
      operationClass: 'widening',
      ...(checkDocuments === undefined ? {} : { checkDocuments }),
    },
  );
}

async function run(operations: readonly AnyMongoMigrationOperation[]) {
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
    destinationContract: usersWithPlan,
    policy,
    frameworkComponents: [],
  });
}

async function validatorOfUsers(): Promise<unknown> {
  const [info] = await db.listCollections({ name: 'users' }, { nameOnly: false }).toArray();
  return info !== undefined && 'options' in info ? info.options?.['validator'] : undefined;
}

describe('MongoMigrationRunner, a validator change that checks the documents first', () => {
  it(
    'stops with the count, one _id and the query that finds the rest when documents do not fit',
    async () => {
      const lacking = new ObjectId('64b7f0c2a1b2c3d4e5f60718');
      await db.createCollection('users');
      await db.collection('users').insertMany([
        { _id: lacking, name: 'Ada' },
        { _id: new ObjectId('64b7f0c2a1b2c3d4e5f60719'), name: 'Bo' },
        { _id: new ObjectId('64b7f0c2a1b2c3d4e5f6071a'), name: 'Cy', plan: 'free' },
      ]);

      const result = await run([addPlanValidator(true)]);

      if (result.ok) throw new Error('Expected the validator change to stop at its document check');
      const query = `db.getCollection("users").find(${JSON.stringify({ $nor: [{ $jsonSchema: schemaWithPlan }] })})`;
      expect({
        code: result.failure.code,
        message: result.failure.message,
        why: result.failure.why,
        meta: result.failure.meta,
        validator: await validatorOfUsers(),
      }).toEqual({
        code: 'MIGRATION.PRECHECK_FAILED',
        message:
          'Operation validator.users.update stopped: 2 documents in collection users do not fit the new validator',
        why: `This validator change makes "name" and "plan" required. One of them has _id ObjectId("64b7f0c2a1b2c3d4e5f60718"). That document has no "plan". Find them all with ${query} in mongosh. ${NO_VALIDATOR_BY_HAND} ${CHECK_DOCUMENTS_FALSE} The validator was not changed. Once the documents are fixed, run the command again; operations that already ran are skipped. The failed apply changed nothing.`,
        meta: {
          databaseUnchanged: true,
          operationId: 'validator.users.update',
          documentsFailingValidator: {
            collection: 'users',
            documents: 2,
            documentId: 'ObjectId("64b7f0c2a1b2c3d4e5f60718")',
            query,
            requires: ['name', 'plan'],
            retypes: [],
          },
        },
        validator: undefined,
      });
      const printed = /\.find\((.*)\) in mongosh/.exec(result.failure.why ?? '')?.[1];
      expect(
        await db
          .collection('users')
          .find(JSON.parse(printed ?? 'null'))
          .toArray(),
      ).toHaveLength(2);
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'says the operations before it stay applied when an index was created first',
    async () => {
      await db.createCollection('users');
      await db
        .collection('users')
        .insertOne({ _id: new ObjectId('64b7f0c2a1b2c3d4e5f60718'), name: 'Ada' });

      const result = await run([
        createIndex('users', [{ field: 'name', direction: 1 }]),
        addPlanValidator(true),
      ]);

      if (result.ok) throw new Error('Expected the validator change to stop at its document check');
      const query = `db.getCollection("users").find(${JSON.stringify({ $nor: [{ $jsonSchema: schemaWithPlan }] })})`;
      expect({
        why: result.failure.why,
        databaseUnchanged: result.failure.meta.databaseUnchanged,
        indexes: (await db.collection('users').indexes()).map(({ name }) => name),
      }).toEqual({
        why: `This validator change makes "name" and "plan" required. It has _id ObjectId("64b7f0c2a1b2c3d4e5f60718"). That document has no "plan". Find them all with ${query} in mongosh. ${NO_VALIDATOR_BY_HAND} ${CHECK_DOCUMENTS_FALSE} The validator was not changed. Once the documents are fixed, run the command again; operations that already ran are skipped. The operations that ran before the failure stay applied.`,
        databaseUnchanged: false,
        indexes: ['_id_', 'name_1'],
      });
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'names why the document it shows does not fit: a missing field, a type, and a field the validator does not name',
    async () => {
      await db.createCollection('users');
      await db
        .collection('users')
        .insertOne({ _id: new ObjectId('64b7f0c2a1b2c3d4e5f60718'), name: 5, legacyScore: 3 });

      const result = await run([addPlanValidator(true)]);

      if (result.ok) throw new Error('Expected the validator change to stop at its document check');
      expect(result.failure.why).toContain(
        'It has _id ObjectId("64b7f0c2a1b2c3d4e5f60718"). That document has no "plan", holds a value of type int in "name", which the new validator does not allow there, and has "legacyScore", a field the new validator does not name.',
      );
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'names --backfill for a field the collection validator did not require, and says the old validator rejects a fix by hand',
    async () => {
      const nameOnly = { ...schemaWithPlan, required: ['_id', 'name'] };
      await db.createCollection('users', { validator: { $jsonSchema: nameOnly } });
      await db.collection('users').insertOne({ name: 'Ada' });

      const result = await run([addPlanValidator(true)]);

      if (result.ok) throw new Error('Expected the validator change to stop at its document check');
      expect(result.failure.why).toContain(
        `To give "plan" values you choose, plan the change with migration plan --backfill User.plan. ${BY_HAND}`,
      );
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'names no --backfill for a field of a root model that shares the collection, which the planner would refuse',
    async () => {
      const root = (required: readonly string[]) => ({
        required: ['_id', ...required],
        properties: {
          _id: { bsonType: 'objectId' },
          name: { bsonType: 'string' },
          plan: { bsonType: 'string' },
        },
        additionalProperties: false,
      });
      const admin = {
        required: ['_id', 'level'],
        properties: { _id: { bsonType: 'objectId' }, level: { bsonType: 'string' } },
        additionalProperties: false,
      };
      const shared = (required: readonly string[]) => ({
        bsonType: 'object',
        anyOf: [root(required), admin],
      });
      await db.createCollection('users', { validator: { $jsonSchema: shared(['name']) } });
      await db.collection('users').insertOne({ name: 'Ada' });

      const result = await run([
        collMod(
          'users',
          { validator: { $jsonSchema: shared(['name', 'plan']) } },
          { id: 'validator.users.update', checkDocuments: true },
        ),
      ]);

      if (result.ok) throw new Error('Expected the validator change to stop at its document check');
      expect({
        backfill: result.failure.why?.includes('--backfill'),
        byHand: result.failure.why?.includes('bypassDocumentValidation: true'),
      }).toEqual({ backfill: false, byHand: true });
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'names the reasons against the variant whose discriminator value the document holds',
    async () => {
      const variants = {
        bsonType: 'object',
        required: ['_id', 'kind'],
        properties: { _id: { bsonType: 'objectId' }, kind: { bsonType: 'string' } },
        oneOf: [
          {
            properties: {
              _id: { bsonType: 'objectId' },
              kind: { enum: ['a'] },
              x: { bsonType: 'string' },
            },
            required: ['kind', 'x'],
            additionalProperties: false,
          },
          {
            properties: {
              _id: { bsonType: 'objectId' },
              kind: { enum: ['b'] },
              y: { bsonType: 'string' },
              z: { bsonType: 'string' },
            },
            required: ['kind', 'y', 'z'],
            additionalProperties: false,
          },
        ],
      };
      await db.createCollection('users');
      await db.collection('users').insertOne({ kind: 'b' });

      const result = await run([
        collMod(
          'users',
          { validator: { $jsonSchema: variants } },
          { id: 'validator.users.update', checkDocuments: true },
        ),
      ]);

      if (result.ok) throw new Error('Expected the validator change to stop at its document check');
      expect(result.failure.why).toContain('That document has no "y" and has no "z".');
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'names the fields whose accepted values the change alters, as what it touches',
    async () => {
      const ageSchema = (bsonType: string) => ({
        bsonType: 'object',
        required: ['_id', 'name'],
        properties: {
          _id: { bsonType: 'objectId' },
          name: { bsonType: 'string' },
          age: { bsonType },
        },
      });
      await db.createCollection('users', { validator: { $jsonSchema: ageSchema('string') } });
      await db.collection('users').insertOne({ name: 'Ada', age: 'forty' });

      const result = await run([
        collMod(
          'users',
          { validator: { $jsonSchema: ageSchema('int') } },
          { id: 'validator.users.update', checkDocuments: true },
        ),
      ]);

      if (result.ok) throw new Error('Expected the validator change to stop at its document check');
      expect({
        start: result.failure.why?.split('. It has')[0],
        touched: result.failure.meta['documentsFailingValidator'],
      }).toMatchObject({
        start: 'This validator change changes what "age" accepts',
        touched: { requires: [], retypes: ['age'] },
      });
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'names a field one variant newly requires though another variant already required it',
    async () => {
      const variants = (bRequires: readonly string[]) => ({
        bsonType: 'object',
        required: ['_id', 'kind'],
        properties: { _id: { bsonType: 'objectId' }, kind: { bsonType: 'string' } },
        oneOf: [
          {
            properties: {
              _id: { bsonType: 'objectId' },
              kind: { enum: ['a'] },
              x: { bsonType: 'string' },
            },
            required: ['kind', 'x'],
            additionalProperties: false,
          },
          {
            properties: {
              _id: { bsonType: 'objectId' },
              kind: { enum: ['b'] },
              x: { bsonType: 'string' },
            },
            required: ['kind', ...bRequires],
            additionalProperties: false,
          },
        ],
      });
      await db.createCollection('users', { validator: { $jsonSchema: variants([]) } });
      await db.collection('users').insertOne({ kind: 'b' });

      const result = await run([
        collMod(
          'users',
          { validator: { $jsonSchema: variants(['x']) } },
          { id: 'validator.users.update', checkDocuments: true },
        ),
      ]);

      if (result.ok) throw new Error('Expected the validator change to stop at its document check');
      expect(result.failure.meta['documentsFailingValidator']).toMatchObject({
        requires: ['x'],
        retypes: [],
      });
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'applies the validator when every document fits',
    async () => {
      await db.createCollection('users');
      await db.collection('users').insertOne({ name: 'Ada', plan: 'free' });

      const result = await run([addPlanValidator(true)]);

      expect(result.ok ? result.value.operationsExecuted : result.failure).toBe(1);
      expect(await validatorOfUsers()).toEqual({ $jsonSchema: schemaWithPlan });
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'applies the validator over documents that do not fit when checkDocuments is left out or false',
    async () => {
      await db.createCollection('users');
      await db.collection('users').insertOne({ name: 'Ada' });

      const leftOut = await run([addPlanValidator(undefined)]);
      await db.command({ collMod: 'users', validator: {} });
      const setFalse = await run([
        setValidation('users', schemaWithPlan, {
          validationLevel: 'strict',
          validationAction: 'error',
          checkDocuments: false,
        }),
      ]);

      expect([leftOut.ok, setFalse.ok]).toEqual([true, true]);
      expect(await validatorOfUsers()).toEqual({ $jsonSchema: schemaWithPlan });
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'does not check again on a re-run after the validator was set',
    async () => {
      await db.createCollection('users');
      await db.collection('users').insertOne({ name: 'Ada', plan: 'free' });
      const first = await run([addPlanValidator(true)]);
      expect(first.ok).toBe(true);
      await db.collection('users').insertOne({ name: 'Bo' }, { bypassDocumentValidation: true });
      await controlAdapter.updateMarker(new MongoControlDriver(db, client), 'app', 'dest', {
        storageHash: 'origin',
        profileHash: 'p1',
      });

      const again = await run([
        setValidation('users', schemaWithPlan, {
          validationLevel: 'strict',
          validationAction: 'error',
          checkDocuments: true,
        }),
      ]);

      expect(again.ok ? again.value.operationsExecuted : again.failure).toBe(0);
    },
    timeouts.spinUpMongoMemoryServer,
  );
});
