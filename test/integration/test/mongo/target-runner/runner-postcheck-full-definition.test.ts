import { MongoControlAdapterImpl } from '@internal/adapter-mongo/control';
import { MongoControlDriver } from '@internal/driver-mongo/control';
import type { MongoIndexKey } from '@internal/mongo-contract';
import type { MongoMigrationPlanOperation } from '@internal/mongo-query-ast/control';
import { FilterEvaluator } from '@internal/target-mongo/control';
import { collMod, createIndex } from '@internal/target-mongo/migration';
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
  for (const collection of await db.listCollections().toArray()) {
    await db.dropCollection(collection['name'] as string);
  }
  await db.createCollection('items');
});

function deps() {
  return controlAdapter.createRunnerDependencies(new MongoControlDriver(db, client));
}

async function postchecksHold(op: MongoMigrationPlanOperation): Promise<boolean> {
  const { inspectionExecutor } = deps();
  const evaluator = new FilterEvaluator();
  for (const check of op.postcheck) {
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
