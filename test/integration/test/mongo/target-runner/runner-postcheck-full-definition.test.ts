import { MongoControlAdapterImpl } from '@internal/adapter-mongo/control';
import { MongoControlDriver } from '@internal/driver-mongo/control';
import type { MongoIndexKey } from '@internal/mongo-contract';
import {
  isInspectionCheckSource,
  type MongoMigrationPlanOperation,
} from '@internal/mongo-query-ast/control';
import { FilterEvaluator } from '@internal/target-mongo/control';
import { collMod, createCollection, createIndex } from '@internal/target-mongo/migration';
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
  db = client.db('runner_postcheck_full_definition_test');
}, timeouts.spinUpMongoMemoryServer);

afterAll(async () => {
  await client?.close();
  await replSet?.stop();
}, timeouts.spinUpMongoMemoryServer);

beforeEach(async () => {
  await db.dropDatabase();
  await db.createCollection('items');
});

function deps() {
  return controlAdapter.createRunnerDependencies(new MongoControlDriver(db, client));
}

async function postchecksHold(op: MongoMigrationPlanOperation): Promise<boolean> {
  const { inspectionExecutor } = deps();
  const evaluator = new FilterEvaluator();
  for (const check of op.postcheck) {
    if (!isInspectionCheckSource(check.source)) throw new Error('Expected a catalog check');
    const documents = await check.source.accept(inspectionExecutor);
    const found = documents.some((doc) => evaluator.evaluate(check.filter, doc));
    if (found !== (check.expect === 'exists')) return false;
  }
  return true;
}

async function execute(op: MongoMigrationPlanOperation): Promise<void> {
  const { executeDdl } = deps();
  for (const step of op.execute) await executeDdl(step.command);
}

const ab: MongoIndexKey[] = [
  { field: 'a', direction: 1 },
  { field: 'b', direction: 1 },
];
const text: MongoIndexKey[] = [
  { field: 'category', direction: 1 },
  { field: 'title', direction: 'text' },
  { field: 'body', direction: 'text' },
];

describe('createIndex postchecks', { timeout: timeouts.spinUpMongoMemoryServer }, () => {
  it.each([
    ['no options', ab, {}],
    ['unique', ab, { unique: true }],
    ['sparse', ab, { sparse: true }],
    ['a TTL', [{ field: 'at', direction: 1 }], { expireAfterSeconds: 60 }],
    ['a partial filter', ab, { partialFilterExpression: { 'x.y': { $gt: 5 } } }],
    ['a collation', ab, { collation: { locale: 'en', strength: 2 } }],
    ['a wildcard projection', [{ field: '$**', direction: 1 }], { wildcardProjection: { a: 1 } }],
    ['text weights', text, { weights: { title: 10 } }],
    ['a text language', text, { default_language: 'spanish', language_override: 'lang' }],
  ] as const)('hold once the operation created an index with %s', async (_, keys, options) => {
    const op = createIndex('items', keys, options);
    await execute(op);

    expect(await postchecksHold(op)).toBe(true);
  });

  it.each([
    ['unique', ab, {}, { unique: true }],
    ['not unique', ab, { unique: true }, {}],
    ['sparse', ab, {}, { sparse: true }],
    [
      'another TTL',
      [{ field: 'at', direction: 1 }],
      { expireAfterSeconds: 60 },
      { expireAfterSeconds: 30 },
    ],
    ['a TTL', [{ field: 'at', direction: 1 }], {}, { expireAfterSeconds: 30 }],
    [
      'another partial filter',
      ab,
      { partialFilterExpression: { a: { $gt: 5 } } },
      { partialFilterExpression: { a: { $gt: 1 } } },
    ],
    ['a partial filter', ab, {}, { partialFilterExpression: { a: { $gt: 1 } } }],
    [
      'another collation',
      ab,
      { collation: { locale: 'en', strength: 2 } },
      { collation: { locale: 'en', strength: 3 } },
    ],
    ['a collation', ab, {}, { collation: { locale: 'en', strength: 2 } }],
    [
      'another wildcard projection',
      [{ field: '$**', direction: 1 }],
      { wildcardProjection: { a: 1 } },
      { wildcardProjection: { b: 1 } },
    ],
    ['other text weights', text, { weights: { title: 10 } }, { weights: { title: 5 } }],
    ['another text language', text, { default_language: 'spanish' }, {}],
  ] as const)('fail while an index on the same keys is %s', async (_, keys, wanted, live) => {
    await execute(createIndex('items', keys, live));

    expect(await postchecksHold(createIndex('items', keys, wanted))).toBe(false);
  });

  it('fail while a text index covers other fields', async () => {
    await execute(createIndex('items', [{ field: 'title', direction: 'text' }]));

    expect(await postchecksHold(createIndex('items', text))).toBe(false);
  });
});

describe('collMod postchecks for a query validator', {
  timeout: timeouts.spinUpMongoMemoryServer,
}, () => {
  const wanted = () =>
    collMod('items', {
      validator: { status: { $in: ['active', 'archived'] } },
      validationLevel: 'strict',
      validationAction: 'error',
    });

  it('hold once the operation set the validator', async () => {
    const op = wanted();
    await execute(op);

    expect(await postchecksHold(op)).toBe(true);
  });

  it('fail while another query validator has the same level and action', async () => {
    await execute(
      collMod('items', {
        validator: { status: { $in: ['active'] } },
        validationLevel: 'strict',
        validationAction: 'error',
      }),
    );

    expect(await postchecksHold(wanted())).toBe(false);
  });
});

describe('createCollection postchecks', { timeout: timeouts.spinUpMongoMemoryServer }, () => {
  it.each([
    ['no options', {}],
    [
      'a validator',
      {
        validator: {
          $jsonSchema: { bsonType: 'object', properties: { a: { bsonType: 'string' } } },
        },
        validationLevel: 'strict',
        validationAction: 'error',
      },
    ],
    ['a cap', { capped: true, size: 5000, max: 10 }],
    ['a collation', { collation: { locale: 'fr', strength: 2 } }],
    ['a time series', { timeseries: { timeField: 'at', metaField: 'source' } }],
    ['a clustered index', { clusteredIndex: { key: { _id: 1 }, unique: true } }],
    ['change stream images', { changeStreamPreAndPostImages: { enabled: true } }],
    ['change stream images turned off', { changeStreamPreAndPostImages: { enabled: false } }],
    ['the simple collation', { collation: { locale: 'simple' } }],
    ['capped turned off', { capped: false }],
    ['a cap with no limit on the number of documents', { capped: true, size: 4096, max: 0 }],
    ['a fractional cap size', { capped: true, size: 1000.5 }],
    ['an empty validator', { validator: {} }],
  ] as const)(
    'hold once the operation created a collection with %s, and not before',
    async (_, options) => {
      const op = createCollection('created', options);
      const before = await postchecksHold(op);
      await execute(op);

      expect({ before, after: await postchecksHold(op) }).toEqual({ before: false, after: true });
    },
  );

  it('does not hold for a view of that name', async () => {
    await db.createCollection('created', { viewOn: 'items', pipeline: [] });

    expect(await postchecksHold(createCollection('created'))).toBe(false);
  });

  it('does not hold for a collection of that name made without the validator', async () => {
    const op = createCollection('items', { validator: { $jsonSchema: { bsonType: 'object' } } });

    expect(await postchecksHold(op)).toBe(false);
  });

  it('does not hold for a collection whose validator adds a predicate to the $jsonSchema', async () => {
    const $jsonSchema = { bsonType: 'object' };
    await db.createCollection('stock', {
      validator: { $jsonSchema, $expr: { $gt: ['$qty', 0] } },
    });

    expect(await postchecksHold(createCollection('stock', { validator: { $jsonSchema } }))).toBe(
      false,
    );
  });
});
