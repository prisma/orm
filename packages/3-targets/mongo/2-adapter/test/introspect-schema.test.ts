import { indexLookupKey } from '@internal/mongo-contract';
import {
  MongoSchemaCollection,
  MongoSchemaCollectionOptions,
  MongoSchemaIndex,
  MongoSchemaIR,
  MongoSchemaValidator,
} from '@internal/mongo-schema-ir';
import { type Db, MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { introspectSchema, isDefaultIdIndex } from '../src/core/introspect-schema';

let replSet: MongoMemoryReplSet;
let client: MongoClient;
let db: Db;
const dbName = 'introspect_schema_test';

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  client = new MongoClient(replSet.getUri());
  await client.connect();
  db = client.db(dbName);
});

afterAll(async () => {
  await client?.close();
  await replSet?.stop();
});

beforeEach(async () => {
  const collections = await db.listCollections().toArray();
  for (const col of collections) {
    const name = col['name'] as string;
    if (name.startsWith('system.')) continue;
    await db.dropCollection(name);
  }
});

describe('introspectSchema', () => {
  it('returns empty IR for empty database', async () => {
    const ir = await introspectSchema(db);

    expect(ir).toBeInstanceOf(MongoSchemaIR);
    expect(ir.collections).toEqual([]);
  });

  it('introspects a collection with no user indexes', async () => {
    await db.createCollection('users');

    const ir = await introspectSchema(db);

    expect(ir.collectionNames).toEqual(['users']);
    const users = ir.collection('users')!;
    expect(users).toBeInstanceOf(MongoSchemaCollection);
    expect(users.name).toBe('users');
    expect(users.indexes).toEqual([]);
  });

  it('introspects indexes with various key types', async () => {
    await db.createCollection('users');
    await db.collection('users').createIndex({ email: 1 }, { unique: true });
    await db.collection('users').createIndex({ lastName: 1, firstName: 1 });
    await db.collection('users').createIndex({ age: -1 });

    const ir = await introspectSchema(db);

    const users = ir.collection('users')!;
    expect(users.indexes).toHaveLength(3);

    const emailIdx = users.indexes.find((i) => i.keys.some((k) => k.field === 'email'))!;
    expect(emailIdx).toBeInstanceOf(MongoSchemaIndex);
    expect(emailIdx.unique).toBe(true);
    expect(emailIdx.keys).toEqual([{ field: 'email', direction: 1 }]);

    const compoundIdx = users.indexes.find((i) => i.keys.some((k) => k.field === 'lastName'))!;
    expect(compoundIdx.keys).toEqual([
      { field: 'lastName', direction: 1 },
      { field: 'firstName', direction: 1 },
    ]);

    const descIdx = users.indexes.find((i) => i.keys.some((k) => k.field === 'age'))!;
    expect(descIdx.keys).toEqual([{ field: 'age', direction: -1 }]);
  });

  it('introspects sparse and TTL index options', async () => {
    await db.createCollection('sessions');
    await db.collection('sessions').createIndex({ token: 1 }, { sparse: true });
    await db.collection('sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 3600 });

    const ir = await introspectSchema(db);

    const sessions = ir.collection('sessions')!;
    const sparseIdx = sessions.indexes.find((i) => i.keys.some((k) => k.field === 'token'))!;
    expect(sparseIdx.sparse).toBe(true);

    const ttlIdx = sessions.indexes.find((i) => i.keys.some((k) => k.field === 'expiresAt'))!;
    expect(ttlIdx.expireAfterSeconds).toBe(3600);
  });

  it('introspects partial filter expression', async () => {
    await db.createCollection('orders');
    await db
      .collection('orders')
      .createIndex({ status: 1 }, { partialFilterExpression: { status: 'active' } });

    const ir = await introspectSchema(db);

    const orders = ir.collection('orders')!;
    const partialIdx = orders.indexes.find((i) => i.keys.some((k) => k.field === 'status'))!;
    expect(partialIdx.partialFilterExpression).toEqual({ status: 'active' });
  });

  it('introspects validators', async () => {
    await db.createCollection('products', {
      validator: {
        $jsonSchema: {
          bsonType: 'object',
          required: ['name', 'price'],
          properties: {
            name: { bsonType: 'string' },
            price: { bsonType: 'number' },
          },
        },
      },
      validationLevel: 'strict',
      validationAction: 'error',
    });

    const ir = await introspectSchema(db);

    const products = ir.collection('products')!;
    expect(products.validator).toBeInstanceOf(MongoSchemaValidator);
    expect(products.validator!.validationLevel).toBe('strict');
    expect(products.validator!.validationAction).toBe('error');
    expect(products.validator!.jsonSchema).toEqual({
      bsonType: 'object',
      required: ['name', 'price'],
      properties: {
        name: { bsonType: 'string' },
        price: { bsonType: 'number' },
      },
    });
  });

  it('introspects collection options (capped)', async () => {
    await db.createCollection('logs', {
      capped: true,
      size: 1048576,
      max: 1000,
    });

    const ir = await introspectSchema(db);

    const logs = ir.collection('logs')!;
    expect(logs.options).toBeInstanceOf(MongoSchemaCollectionOptions);
    expect(logs.options!.capped).toEqual({ size: 1048576, max: 1000 });
  });

  it('skips the _prisma_migrations collection', async () => {
    await db.createCollection('_prisma_migrations');
    await db.createCollection('users');

    const ir = await introspectSchema(db);

    expect(ir.collectionNames).toEqual(['users']);
  });

  it('skips views', async () => {
    await db.createCollection('users');
    await db.createCollection('active_users', {});
    await db.command({
      create: 'user_view',
      viewOn: 'users',
      pipeline: [{ $match: { active: true } }],
    });

    const ir = await introspectSchema(db);

    expect(ir.collection('user_view')).toBeUndefined();
    expect(ir.collection('users')).toBeDefined();
  });

  it('filters out the default _id_ index', async () => {
    await db.createCollection('users');
    await db.collection('users').createIndex({ email: 1 });

    const ir = await introspectSchema(db);

    const users = ir.collection('users')!;
    const idIndex = users.indexes.find((i) => i.keys.some((k) => k.field === '_id'));
    expect(idIndex).toBeUndefined();
    expect(users.indexes).toHaveLength(1);
    expect(users.indexes[0]!.keys[0]!.field).toBe('email');
  });

  it('introspects multiple collections', async () => {
    await db.createCollection('users');
    await db.createCollection('posts');
    await db.collection('users').createIndex({ email: 1 }, { unique: true });
    await db.collection('posts').createIndex({ authorId: 1 });

    const ir = await introspectSchema(db);

    expect(ir.collectionNames).toEqual(['posts', 'users']);
    expect(ir.collection('users')!.indexes).toHaveLength(1);
    expect(ir.collection('posts')!.indexes).toHaveLength(1);
  });

  describe('round-trip with contractToMongoSchemaIR', () => {
    it('produces equivalent IR through contract -> apply -> introspect', async () => {
      const contractIR = new MongoSchemaIR([
        new MongoSchemaCollection({
          name: 'users',
          indexes: [
            new MongoSchemaIndex({
              keys: [{ field: 'email', direction: 1 }],
              unique: true,
            }),
            new MongoSchemaIndex({
              keys: [
                { field: 'lastName', direction: 1 },
                { field: 'firstName', direction: 1 },
              ],
            }),
          ],
        }),
      ]);

      await db.createCollection('users');
      await db.collection('users').createIndex({ email: 1 }, { unique: true });
      await db.collection('users').createIndex({ lastName: 1, firstName: 1 });

      const liveIR = await introspectSchema(db);

      const liveUsers = liveIR.collection('users')!;
      const contractUsers = contractIR.collection('users')!;

      expect(liveUsers.indexes).toHaveLength(contractUsers.indexes.length);

      for (const contractIdx of contractUsers.indexes) {
        const matchingLiveIdx = liveUsers.indexes.find(
          (li) => indexLookupKey(li) === indexLookupKey(contractIdx),
        );
        expect(matchingLiveIdx).toBeDefined();
      }
    });
  });

  describe('defensive parsing paths (synthesized inputs)', () => {
    type IndexDoc = Record<string, unknown>;
    type CollectionInfo = Record<string, unknown>;

    function makeDb(
      collections: ReadonlyArray<{
        readonly info: CollectionInfo;
        readonly indexes: readonly IndexDoc[];
      }>,
    ): Db {
      const fake = {
        listCollections: () => ({
          toArray: async () => collections.map((c) => c.info),
        }),
        collection: (name: string) => ({
          listIndexes: () => ({
            toArray: async () => {
              const found = collections.find(
                (c) => (c.info['name'] as string | undefined) === name,
              );
              return found ? [...found.indexes] : [];
            },
          }),
        }),
      };
      return fake as unknown as Db;
    }

    it('isDefaultIdIndex returns false when the doc lacks a `key` field', () => {
      expect(isDefaultIdIndex({ name: 'no_key' })).toBe(false);
    });

    it('isDefaultIdIndex returns true for the canonical _id_ index spec', () => {
      expect(isDefaultIdIndex({ key: { _id: 1 } })).toBe(true);
    });

    it('treats a non-jsonSchema validator as no validator', async () => {
      const fakeDb = makeDb([
        {
          info: {
            name: 'audit',
            options: { validator: { $expr: { $gt: ['$amount', 0] } } },
          },
          indexes: [],
        },
      ]);
      const ir = await introspectSchema(fakeDb);
      expect(ir.collection('audit')!.validator).toBeUndefined();
    });

    it('falls back to validation defaults when level/action are absent', async () => {
      const fakeDb = makeDb([
        {
          info: {
            name: 'products',
            options: { validator: { $jsonSchema: { bsonType: 'object' } } },
          },
          indexes: [],
        },
      ]);
      const ir = await introspectSchema(fakeDb);
      const validator = ir.collection('products')!.validator!;
      expect(validator.validationLevel).toBe('strict');
      expect(validator.validationAction).toBe('error');
    });

    it('returns no collection options when the info has no options bag', async () => {
      const fakeDb = makeDb([{ info: { name: 'plain' }, indexes: [] }]);
      const ir = await introspectSchema(fakeDb);
      expect(ir.collection('plain')!.options).toBeUndefined();
    });

    it('forwards timeseries options when present', async () => {
      const fakeDb = makeDb([
        {
          info: {
            name: 'metrics',
            options: {
              timeseries: { timeField: 'ts', metaField: 'tags', granularity: 'minutes' },
            },
          },
          indexes: [],
        },
      ]);
      const ir = await introspectSchema(fakeDb);
      expect(ir.collection('metrics')!.options!.timeseries).toEqual({
        timeField: 'ts',
        metaField: 'tags',
        granularity: 'minutes',
      });
    });

    it('forwards collation, changeStreamPreAndPostImages, and clusteredIndex options when present', async () => {
      const fakeDb = makeDb([
        {
          info: {
            name: 'configured',
            options: {
              collation: { locale: 'en_US' },
              changeStreamPreAndPostImages: { enabled: true },
              clusteredIndex: { name: 'ix' },
            },
          },
          indexes: [],
        },
      ]);
      const ir = await introspectSchema(fakeDb);
      const opts = ir.collection('configured')!.options!;
      expect(opts.collation).toEqual({ locale: 'en_US' });
      expect(opts.changeStreamPreAndPostImages).toEqual({ enabled: true });
      expect(opts.clusteredIndex).toEqual({ name: 'ix' });
    });

    it('keeps capped options without `max` when max is omitted', async () => {
      const fakeDb = makeDb([
        {
          info: {
            name: 'capped_no_max',
            options: { capped: true, size: 4096 },
          },
          indexes: [],
        },
      ]);
      const ir = await introspectSchema(fakeDb);
      const capped = ir.collection('capped_no_max')!.options!.capped;
      expect(capped).toEqual({ size: 4096 });
    });
  });
});
