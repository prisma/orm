import { castField, fillField } from '@internal/target-mongo/migration';
import { timeouts } from '@repo/test-utils';
import { type Db, type Document, MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

let replSet: MongoMemoryReplSet;
let client: MongoClient;
let db: Db;
const dbName = 'runner_rewrite_filters_test';

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
  await db.collection('users').deleteMany({});
  await db
    .collection('users')
    .insertMany([
      { name: 'list of ints', age: [1, 2] },
      { name: 'list of an int and a string', age: [1, 'a'] },
      { name: 'list with a null', age: [1, null] },
      { name: 'empty list', age: [] },
      { name: 'int', age: 5 },
      { name: 'string', age: 's' },
      { name: 'null', age: null },
      { name: 'missing' },
    ]);
});

/** The names of the documents a rewrite's filter selects, read with its own postcheck pipeline. */
async function selected(pipeline: readonly unknown[]): Promise<string[]> {
  const [match] = pipeline;
  const documents = await db
    .collection('users')
    .aggregate([match as Document, { $project: { _id: 0, name: 1 } }])
    .toArray();
  return documents.map((document) => String(document['name'])).sort();
}

function postcheckPipeline(operation: ReturnType<typeof castField>): readonly unknown[] {
  const source = operation.postcheck[0]?.source;
  const command = source !== undefined && 'command' in source ? source.command : undefined;
  return command !== undefined && 'pipeline' in command ? command.pipeline : [];
}

describe('the documents a MongoDB rewrite selects', () => {
  it(
    'a single value cast selects only the values of the types it is cast from',
    async () => {
      expect(
        await selected(
          postcheckPipeline(
            castField({ collection: 'users', field: 'age', from: ['string'], to: 'int' }),
          ),
        ),
      ).toEqual(['string']);
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'a list cast selects every list with an element of a type it is cast from',
    async () => {
      expect(
        await selected(
          postcheckPipeline(
            castField({
              collection: 'users',
              field: 'age',
              from: ['string'],
              to: 'int',
              list: true,
            }),
          ),
        ),
      ).toEqual(['list of an int and a string']);
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'a fill selects the documents where the field is missing or null, and no list',
    async () => {
      expect(
        await selected(
          postcheckPipeline(fillField({ collection: 'users', field: 'age', value: 0 })),
        ),
      ).toEqual(['missing', 'null']);
    },
    timeouts.spinUpMongoMemoryServer,
  );
});
