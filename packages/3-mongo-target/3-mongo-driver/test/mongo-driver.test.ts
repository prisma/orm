import {
  AggregateWireCommand,
  CollModWireCommand,
  CreateCollectionWireCommand,
  CreateIndexWireCommand,
  DeleteManyWireCommand,
  DeleteOneWireCommand,
  DropCollectionWireCommand,
  DropIndexWireCommand,
  FindOneAndDeleteWireCommand,
  FindOneAndUpdateWireCommand,
  InsertManyWireCommand,
  InsertOneWireCommand,
  UpdateManyWireCommand,
  UpdateOneWireCommand,
} from '@internal/mongo-wire';
import { BSONRegExp, Double, Long, MongoClient, type ObjectId } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMongoDriver, MongoDriverImpl } from '../src/mongo-driver';

let replSet: MongoMemoryReplSet;
let connectionUri: string;
let seedClient: MongoClient;
const dbName = 'driver_test';

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  connectionUri = replSet.getUri();
  seedClient = new MongoClient(connectionUri);
  await seedClient.connect();
});

afterAll(async () => {
  await seedClient?.close();
  await replSet?.stop();
});

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) {
    items.push(item);
  }
  return items;
}

describe('MongoDriver', () => {
  describe('insertOne', () => {
    const col = 'driver_insert';

    it('inserts and returns insertedId', async () => {
      const driver = await createMongoDriver(connectionUri, dbName);
      try {
        const cmd = new InsertOneWireCommand(col, { name: 'Dave', age: 28 });
        const rows = await collect(driver.execute(cmd));
        expect(rows).toHaveLength(1);
        expect(rows[0]).toHaveProperty('insertedId');
      } finally {
        await driver.close();
      }
    });
  });

  describe('the document an insert returns', () => {
    const written = () => ({
      small: Long.fromNumber(5),
      whole: new Double(2),
      pattern: new BSONRegExp('x.y', 'm'),
      bytes: new Uint8Array([9]),
    });

    it('is the written document with its _id, as a read with the client`s options returns it', async () => {
      const driver = await createMongoDriver(connectionUri, dbName);
      try {
        const [one] = await collect(
          driver.execute(new InsertOneWireCommand('driver_returned', written())),
        );
        const [many] = await collect(
          driver.execute(new InsertManyWireCommand('driver_returned', [written(), written()])),
        );
        const stored = await seedClient
          .db(dbName)
          .collection('driver_returned')
          .findOne({ _id: (one as { insertedId: ObjectId }).insertedId });
        expect((one as { document: unknown }).document).toEqual(stored);
        expect((many as { documents: unknown[] }).documents).toHaveLength(2);
        expect((many as { documents: { _id: unknown }[] }).documents.map(({ _id }) => _id)).toEqual(
          (many as { insertedIds: unknown[] }).insertedIds,
        );
      } finally {
        await driver.close();
      }
    });

    it('follows the client`s BSON options', async () => {
      const client = new MongoClient(connectionUri, { promoteLongs: false });
      await client.connect();
      try {
        const driver = MongoDriverImpl.fromDb(client.db(dbName));
        const [one] = await collect(
          driver.execute(new InsertOneWireCommand('driver_returned', written())),
        );
        expect((one as { document: { small: unknown } }).document.small).toBeInstanceOf(Long);
      } finally {
        await client.close();
      }
    });
  });

  describe('updateOne', () => {
    const col = 'driver_update';

    it('updates and returns matched/modified counts', async () => {
      const driver = await createMongoDriver(connectionUri, dbName);
      try {
        const db = seedClient.db(dbName);
        await db.collection(col).deleteMany({});
        await db.collection(col).insertOne({ name: 'Eve', age: 22 });

        const cmd = new UpdateOneWireCommand(col, { name: 'Eve' }, { $set: { age: 23 } });
        const rows = await collect(driver.execute(cmd));
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ matchedCount: 1, modifiedCount: 1 });
      } finally {
        await driver.close();
      }
    });
  });

  describe('deleteOne', () => {
    const col = 'driver_delete';

    it('deletes and returns deletedCount', async () => {
      const driver = await createMongoDriver(connectionUri, dbName);
      try {
        const db = seedClient.db(dbName);
        await db.collection(col).deleteMany({});
        await db.collection(col).insertOne({ name: 'Frank' });

        const cmd = new DeleteOneWireCommand(col, { name: 'Frank' });
        const rows = await collect(driver.execute(cmd));
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ deletedCount: 1 });
      } finally {
        await driver.close();
      }
    });
  });

  describe('insertMany', () => {
    const col = 'driver_insert_many';

    it('inserts multiple documents and returns ids', async () => {
      const driver = await createMongoDriver(connectionUri, dbName);
      try {
        const cmd = new InsertManyWireCommand(col, [
          { name: 'Alice', age: 30 },
          { name: 'Bob', age: 25 },
        ]);
        const rows = await collect(driver.execute(cmd));
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ insertedCount: 2 });
        expect((rows[0] as { insertedIds: unknown[] }).insertedIds).toHaveLength(2);
      } finally {
        await driver.close();
      }
    });
  });

  describe('updateMany', () => {
    const col = 'driver_update_many';

    it('updates multiple documents and returns counts', async () => {
      const driver = await createMongoDriver(connectionUri, dbName);
      try {
        const db = seedClient.db(dbName);
        await db.collection(col).deleteMany({});
        await db.collection(col).insertMany([
          { status: 'active', name: 'A' },
          { status: 'active', name: 'B' },
          { status: 'inactive', name: 'C' },
        ]);

        const cmd = new UpdateManyWireCommand(
          col,
          { status: 'active' },
          { $set: { status: 'archived' } },
        );
        const rows = await collect(driver.execute(cmd));
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ matchedCount: 2, modifiedCount: 2 });
      } finally {
        await driver.close();
      }
    });
  });

  describe('deleteMany', () => {
    const col = 'driver_delete_many';

    it('deletes multiple documents and returns count', async () => {
      const driver = await createMongoDriver(connectionUri, dbName);
      try {
        const db = seedClient.db(dbName);
        await db.collection(col).deleteMany({});
        await db
          .collection(col)
          .insertMany([{ status: 'old' }, { status: 'old' }, { status: 'new' }]);

        const cmd = new DeleteManyWireCommand(col, { status: 'old' });
        const rows = await collect(driver.execute(cmd));
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ deletedCount: 2 });
      } finally {
        await driver.close();
      }
    });
  });

  describe('findOneAndUpdate', () => {
    const col = 'driver_find_update';

    it('updates and returns the modified document when returnDocument=after', async () => {
      const driver = await createMongoDriver(connectionUri, dbName);
      try {
        const db = seedClient.db(dbName);
        await db.collection(col).deleteMany({});
        await db.collection(col).insertOne({ name: 'Grace', age: 30 });

        const cmd = new FindOneAndUpdateWireCommand(
          col,
          { name: 'Grace' },
          { $set: { age: 31 } },
          false,
          undefined,
          'after',
        );
        const rows = await collect(driver.execute(cmd));
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ name: 'Grace', age: 31 });
      } finally {
        await driver.close();
      }
    });

    it('upserts and returns the inserted document when returnDocument=after', async () => {
      const driver = await createMongoDriver(connectionUri, dbName);
      try {
        const db = seedClient.db(dbName);
        await db.collection(col).deleteMany({});

        const cmd = new FindOneAndUpdateWireCommand(
          col,
          { name: 'Heidi' },
          { $set: { age: 25 } },
          true,
          undefined,
          'after',
        );
        const rows = await collect(driver.execute(cmd));
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ name: 'Heidi', age: 25 });
      } finally {
        await driver.close();
      }
    });

    it('yields nothing when no match and upsert is false', async () => {
      const driver = await createMongoDriver(connectionUri, dbName);
      try {
        const db = seedClient.db(dbName);
        await db.collection(col).deleteMany({});

        const cmd = new FindOneAndUpdateWireCommand(
          col,
          { name: 'Nobody' },
          { $set: { age: 99 } },
          false,
        );
        const rows = await collect(driver.execute(cmd));
        expect(rows).toHaveLength(0);
      } finally {
        await driver.close();
      }
    });
  });

  describe('findOneAndDelete', () => {
    const col = 'driver_find_delete';

    it('deletes and returns the removed document', async () => {
      const driver = await createMongoDriver(connectionUri, dbName);
      try {
        const db = seedClient.db(dbName);
        await db.collection(col).deleteMany({});
        await db.collection(col).insertOne({ name: 'Ivan', age: 40 });

        const cmd = new FindOneAndDeleteWireCommand(col, { name: 'Ivan' });
        const rows = await collect(driver.execute(cmd));
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ name: 'Ivan', age: 40 });
      } finally {
        await driver.close();
      }
    });

    it('yields nothing when no match', async () => {
      const driver = await createMongoDriver(connectionUri, dbName);
      try {
        const db = seedClient.db(dbName);
        await db.collection(col).deleteMany({});

        const cmd = new FindOneAndDeleteWireCommand(col, { name: 'Nobody' });
        const rows = await collect(driver.execute(cmd));
        expect(rows).toHaveLength(0);
      } finally {
        await driver.close();
      }
    });
  });

  describe('aggregate', () => {
    const col = 'driver_aggregate';

    it('runs pipeline and returns results', async () => {
      const driver = await createMongoDriver(connectionUri, dbName);
      try {
        const db = seedClient.db(dbName);
        await db.collection(col).deleteMany({});
        await db.collection(col).insertMany([
          { dept: 'eng', amount: 100 },
          { dept: 'eng', amount: 200 },
          { dept: 'sales', amount: 50 },
        ]);

        const cmd = new AggregateWireCommand(col, [
          { $group: { _id: '$dept', total: { $sum: '$amount' } } },
          { $sort: { _id: 1 } },
        ]);
        const rows = await collect(driver.execute(cmd));
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({ _id: 'eng', total: 300 });
        expect(rows[1]).toMatchObject({ _id: 'sales', total: 50 });
      } finally {
        await driver.close();
      }
    });
  });

  describe('close', () => {
    it('closes without error', async () => {
      const driver = await createMongoDriver(connectionUri, dbName);
      await expect(driver.close()).resolves.toBeUndefined();
    });
  });

  describe('fromDb', () => {
    it('executes commands on a pre-built Db without owning the client', async () => {
      const db = seedClient.db(dbName);
      const col = 'driver_from_db';
      await db.collection(col).deleteMany({});

      const driver = MongoDriverImpl.fromDb(db);
      const cmd = new InsertOneWireCommand(col, { name: 'test' });
      const rows = await collect(driver.execute(cmd));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toHaveProperty('insertedId');
    });

    it('close() is a no-op — does not close the external client', async () => {
      const driver = MongoDriverImpl.fromDb(seedClient.db(dbName));
      await expect(driver.close()).resolves.toBeUndefined();
      const pingResult = await seedClient.db(dbName).command({ ping: 1 });
      expect(pingResult).toMatchObject({ ok: 1 });
    });
  });

  describe('createCollection', () => {
    it('creates the collection', async () => {
      const db = seedClient.db(dbName);
      const driver = MongoDriverImpl.fromDb(db);
      const col = 'driver_create_col';

      await db.dropCollection(col).catch(() => undefined);

      await driver.run(new CreateCollectionWireCommand(col, {}));

      const colls = await db.listCollections({ name: col }).toArray();
      expect(colls).toHaveLength(1);
      expect(colls[0]).toMatchObject({ name: col });
    });

    it('creates the collection with options', async () => {
      const db = seedClient.db(dbName);
      const driver = MongoDriverImpl.fromDb(db);
      const col = 'driver_create_col_opts';

      await db.dropCollection(col).catch(() => undefined);

      await driver.run(new CreateCollectionWireCommand(col, { capped: true, size: 1024 * 1024 }));

      const colls = await db.listCollections({ name: col }).toArray();
      expect(colls).toHaveLength(1);
      expect(colls[0]).toMatchObject({ name: col, options: { capped: true, size: 1024 * 1024 } });
    });
  });

  describe('createIndex', () => {
    it('creates an index with a key spec', async () => {
      const db = seedClient.db(dbName);
      const driver = MongoDriverImpl.fromDb(db);
      const col = 'driver_create_idx';

      await db.dropCollection(col).catch(() => undefined);
      await db.createCollection(col);

      await driver.run(new CreateIndexWireCommand(col, { email: 1 }, {}));

      const indexes = await db.collection(col).indexes();
      expect(indexes.some((idx) => Object.hasOwn(idx.key, 'email'))).toBe(true);
    });

    it('creates a unique index with options', async () => {
      const db = seedClient.db(dbName);
      const driver = MongoDriverImpl.fromDb(db);
      const col = 'driver_create_idx_opts';

      await db.dropCollection(col).catch(() => undefined);
      await db.createCollection(col);

      await driver.run(
        new CreateIndexWireCommand(col, { username: 1 }, { unique: true, name: 'uniq_username' }),
      );

      const indexes = await db.collection(col).indexes();
      const idx = indexes.find((i) => i.name === 'uniq_username');
      expect(idx).toBeDefined();
      expect(idx).toMatchObject({ unique: true, key: { username: 1 } });
    });
  });

  describe('dropCollection', () => {
    it('drops the collection', async () => {
      const db = seedClient.db(dbName);
      const driver = MongoDriverImpl.fromDb(db);
      const col = 'driver_drop_col';

      await db.dropCollection(col).catch(() => undefined);
      await db.createCollection(col);

      await driver.run(new DropCollectionWireCommand(col));

      const colls = await db.listCollections({ name: col }).toArray();
      expect(colls).toHaveLength(0);
    });
  });

  describe('dropIndex', () => {
    it('drops a named index', async () => {
      const db = seedClient.db(dbName);
      const driver = MongoDriverImpl.fromDb(db);
      const col = 'driver_drop_idx';

      await db.dropCollection(col).catch(() => undefined);
      await db.createCollection(col);
      await db.collection(col).createIndex({ score: 1 }, { name: 'score_idx' });

      await driver.run(new DropIndexWireCommand(col, 'score_idx'));

      const indexes = await db.collection(col).indexes();
      expect(indexes.every((idx) => idx.name !== 'score_idx')).toBe(true);
    });
  });

  describe('collMod', () => {
    it('applies collMod options to the collection', async () => {
      const db = seedClient.db(dbName);
      const driver = MongoDriverImpl.fromDb(db);
      const col = 'driver_collmod';

      await db.dropCollection(col).catch(() => undefined);
      await db.createCollection(col);

      const validator = { $jsonSchema: { bsonType: 'object' } };
      await driver.run(
        new CollModWireCommand(col, {
          validator,
          validationLevel: 'strict',
        }),
      );

      const colls = await db.listCollections({ name: col }, { nameOnly: false }).toArray();
      expect(colls).toHaveLength(1);
      expect(colls[0]).toMatchObject({
        name: col,
        options: {
          validator,
          validationLevel: 'strict',
        },
      });
    });
  });

  describe('createCollection — option branches', () => {
    it('passes validator and validationAction', async () => {
      const db = seedClient.db(dbName);
      const driver = MongoDriverImpl.fromDb(db);
      const col = 'driver_cc_validation';
      await db.dropCollection(col).catch(() => undefined);

      const validator = { $jsonSchema: { bsonType: 'object' } };
      await driver.run(
        new CreateCollectionWireCommand(col, {
          validator,
          validationAction: 'warn',
        }),
      );

      const colls = await db.listCollections({ name: col }, { nameOnly: false }).toArray();
      expect(colls).toHaveLength(1);
      expect(colls[0]).toMatchObject({
        options: { validator, validationAction: 'warn' },
      });
    });

    it('passes capped, size and max', async () => {
      const db = seedClient.db(dbName);
      const driver = MongoDriverImpl.fromDb(db);
      const col = 'driver_cc_capped_max';
      await db.dropCollection(col).catch(() => undefined);

      await driver.run(
        new CreateCollectionWireCommand(col, { capped: true, size: 1024 * 1024, max: 100 }),
      );

      const colls = await db.listCollections({ name: col }, { nameOnly: false }).toArray();
      expect(colls).toHaveLength(1);
      expect(colls[0]).toMatchObject({
        options: { capped: true, size: 1024 * 1024, max: 100 },
      });
    });

    it('passes collation', async () => {
      const db = seedClient.db(dbName);
      const driver = MongoDriverImpl.fromDb(db);
      const col = 'driver_cc_collation';
      await db.dropCollection(col).catch(() => undefined);

      await driver.run(
        new CreateCollectionWireCommand(col, {
          collation: { locale: 'en', strength: 2 },
        }),
      );

      const colls = await db.listCollections({ name: col }, { nameOnly: false }).toArray();
      expect(colls).toHaveLength(1);
      expect(colls[0]).toMatchObject({
        options: { collation: { locale: 'en', strength: 2 } },
      });
    });

    it('passes changeStreamPreAndPostImages', async () => {
      const db = seedClient.db(dbName);
      const driver = MongoDriverImpl.fromDb(db);
      const col = 'driver_cc_cspp';
      await db.dropCollection(col).catch(() => undefined);

      await driver.run(
        new CreateCollectionWireCommand(col, {
          changeStreamPreAndPostImages: { enabled: true },
        }),
      );

      const colls = await db.listCollections({ name: col }, { nameOnly: false }).toArray();
      expect(colls).toHaveLength(1);
      expect(colls[0]).toMatchObject({
        options: { changeStreamPreAndPostImages: { enabled: true } },
      });
    });

    it('passes clusteredIndex', async () => {
      const db = seedClient.db(dbName);
      const driver = MongoDriverImpl.fromDb(db);
      const col = 'driver_cc_clustered';
      await db.dropCollection(col).catch(() => undefined);

      await driver.run(
        new CreateCollectionWireCommand(col, {
          clusteredIndex: { key: { _id: 1 }, unique: true },
        }),
      );

      const colls = await db.listCollections({ name: col }, { nameOnly: false }).toArray();
      expect(colls).toHaveLength(1);
      expect(colls[0]).toMatchObject({ name: col });
    });

    it('passes timeseries options', async () => {
      const db = seedClient.db(dbName);
      const driver = MongoDriverImpl.fromDb(db);
      const col = 'driver_cc_timeseries';
      await db.dropCollection(col).catch(() => undefined);

      await driver.run(
        new CreateCollectionWireCommand(col, {
          timeseries: { timeField: 'ts', metaField: 'meta', granularity: 'seconds' },
        }),
      );

      const colls = await db.listCollections({ name: col }, { nameOnly: false }).toArray();
      expect(colls).toHaveLength(1);
      expect(colls[0]).toMatchObject({ name: col });
    });

    it('passes validationLevel without other options', async () => {
      const db = seedClient.db(dbName);
      const driver = MongoDriverImpl.fromDb(db);
      const col = 'driver_cc_vallevel';
      await db.dropCollection(col).catch(() => undefined);

      await driver.run(new CreateCollectionWireCommand(col, { validationLevel: 'moderate' }));

      const colls = await db.listCollections({ name: col }, { nameOnly: false }).toArray();
      expect(colls).toHaveLength(1);
      expect(colls[0]).toMatchObject({
        options: { validationLevel: 'moderate' },
      });
    });
  });

  describe('createIndex — option branches', () => {
    it('passes sparse and expireAfterSeconds', async () => {
      const db = seedClient.db(dbName);
      const driver = MongoDriverImpl.fromDb(db);
      const col = 'driver_idx_sparse_ttl';
      await db.dropCollection(col).catch(() => undefined);
      await db.createCollection(col);

      await driver.run(
        new CreateIndexWireCommand(
          col,
          { lastSeen: 1 },
          { sparse: true, expireAfterSeconds: 3600 },
        ),
      );

      const indexes = await db.collection(col).indexes();
      const idx = indexes.find((i) => Object.hasOwn(i.key, 'lastSeen'));
      expect(idx).toMatchObject({ sparse: true, expireAfterSeconds: 3600 });
    });

    it('passes partialFilterExpression', async () => {
      const db = seedClient.db(dbName);
      const driver = MongoDriverImpl.fromDb(db);
      const col = 'driver_idx_partial';
      await db.dropCollection(col).catch(() => undefined);
      await db.createCollection(col);

      await driver.run(
        new CreateIndexWireCommand(
          col,
          { status: 1 },
          { partialFilterExpression: { status: { $exists: true } }, name: 'partial_status' },
        ),
      );

      const indexes = await db.collection(col).indexes();
      const idx = indexes.find((i) => i.name === 'partial_status');
      expect(idx).toBeDefined();
      expect(idx).toMatchObject({ partialFilterExpression: { status: { $exists: true } } });
    });

    it('passes collation', async () => {
      const db = seedClient.db(dbName);
      const driver = MongoDriverImpl.fromDb(db);
      const col = 'driver_idx_collation';
      await db.dropCollection(col).catch(() => undefined);
      await db.createCollection(col);

      await driver.run(
        new CreateIndexWireCommand(
          col,
          { title: 1 },
          { collation: { locale: 'fr', strength: 1 }, name: 'title_collated' },
        ),
      );

      const indexes = await db.collection(col).indexes();
      const idx = indexes.find((i) => i.name === 'title_collated');
      expect(idx).toBeDefined();
      expect(idx).toMatchObject({ collation: { locale: 'fr', strength: 1 } });
    });

    it('passes weights, default_language and language_override for text index', async () => {
      const db = seedClient.db(dbName);
      const driver = MongoDriverImpl.fromDb(db);
      const col = 'driver_idx_text';
      await db.dropCollection(col).catch(() => undefined);
      await db.createCollection(col);

      await driver.run(
        new CreateIndexWireCommand(
          col,
          { content: 'text' },
          {
            weights: { content: 10 },
            default_language: 'english',
            language_override: 'lang',
            name: 'text_idx',
          },
        ),
      );

      const indexes = await db.collection(col).indexes();
      const idx = indexes.find((i) => i.name === 'text_idx');
      expect(idx).toBeDefined();
      expect(idx).toMatchObject({
        weights: { content: 10 },
        default_language: 'english',
        language_override: 'lang',
      });
    });

    it('passes wildcardProjection for wildcard index', async () => {
      const db = seedClient.db(dbName);
      const driver = MongoDriverImpl.fromDb(db);
      const col = 'driver_idx_wildcard';
      await db.dropCollection(col).catch(() => undefined);
      await db.createCollection(col);

      await driver.run(
        new CreateIndexWireCommand(
          col,
          { '$**': 1 },
          { wildcardProjection: { tags: 1 }, name: 'wildcard_idx' },
        ),
      );

      const indexes = await db.collection(col).indexes();
      const idx = indexes.find((i) => i.name === 'wildcard_idx');
      expect(idx).toBeDefined();
    });
  });

  describe('collMod — option branches', () => {
    it('passes validationAction', async () => {
      const db = seedClient.db(dbName);
      const driver = MongoDriverImpl.fromDb(db);
      const col = 'driver_collmod_valaction';
      await db.dropCollection(col).catch(() => undefined);
      await db.createCollection(col);

      await driver.run(new CollModWireCommand(col, { validationAction: 'warn' }));

      const colls = await db.listCollections({ name: col }, { nameOnly: false }).toArray();
      expect(colls).toHaveLength(1);
      expect(colls[0]).toMatchObject({
        options: { validationAction: 'warn' },
      });
    });

    it('passes changeStreamPreAndPostImages', async () => {
      const db = seedClient.db(dbName);
      const driver = MongoDriverImpl.fromDb(db);
      const col = 'driver_collmod_cspp';
      await db.dropCollection(col).catch(() => undefined);
      await db.createCollection(col);

      await driver.run(
        new CollModWireCommand(col, { changeStreamPreAndPostImages: { enabled: true } }),
      );

      const colls = await db.listCollections({ name: col }, { nameOnly: false }).toArray();
      expect(colls).toHaveLength(1);
      expect(colls[0]).toMatchObject({
        options: { changeStreamPreAndPostImages: { enabled: true } },
      });
    });
  });

  describe('run() error propagation', () => {
    it('rejects when the server returns an error', async () => {
      const db = seedClient.db(dbName);
      const driver = MongoDriverImpl.fromDb(db);

      await expect(
        driver.run(
          new CollModWireCommand('nonexistent_collection_xyz', { validationLevel: 'strict' }),
        ),
      ).rejects.toThrow();
    });
  });
});
