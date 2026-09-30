import mongo from '@internal/mongo/runtime';
import { timeouts } from '@repo/test-utils';
import { MongoClient, type MongoClientOptions } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

const bytes = new Uint8Array([0, 1, 2, 250, 255]);

describe('Mongo Binary fields under the client`s BSON options', {
  timeout: timeouts.spinUpMongoMemoryServer,
}, () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      instanceOpts: [
        { launchTimeout: timeouts.spinUpMongoMemoryServer, storageEngine: 'wiredTiger' },
      ],
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
  }, timeouts.spinUpMongoMemoryServer);

  afterAll(async () => {
    await replSet?.stop();
  }, timeouts.spinUpMongoMemoryServer);

  it.each<[string, MongoClientOptions]>([
    ['promoteBuffers: true', { promoteBuffers: true }],
    ['promoteValues: false', { promoteValues: false }],
  ])('return and read back a plain Uint8Array with %s', async (name, options) => {
    const dbName = `bson_options_${name.replace(/\W+/g, '_')}`;
    const client = new MongoClient(replSet.getUri(), options);
    const db = mongo<Contract>({ contractJson, mongoClient: client, dbName });
    try {
      const created = await db.orm.posts.create({
        views: 1n,
        price: '1',
        thumbnail: bytes,
        meta: { a: 'b' },
      });
      const [listed] = await db.orm.series
        .createAll([
          {
            ints: [],
            doubles: [],
            longs: [],
            ids: [],
            decimals: [],
            bytes: [bytes],
            words: [],
            flags: [],
            dates: [],
            points: [],
          },
        ])
        .toArray();
      const read = await db.orm.posts.where({ _id: created._id }).first();

      for (const value of [created.thumbnail, listed?.bytes[0], read?.thumbnail]) {
        expect(value).toEqual(bytes);
        expect(Buffer.isBuffer(value)).toBe(false);
      }
    } finally {
      await db.close();
      await client.close();
    }
  });
});
