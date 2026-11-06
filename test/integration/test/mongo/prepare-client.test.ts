import { defineContract, field, model } from '@internal/mongo/contract-builder';
import mongo from '@internal/mongo/runtime';
import { MongoPreparedParamRef } from '@internal/mongo-value';
import { timeouts } from '@repo/test-utils';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const contract = defineContract({
  models: {
    Account: model('Account', {
      collection: 'accounts',
      fields: {
        _id: field.objectId(),
        email: field.string(),
        status: field.string(),
        visits: field.int32(),
      },
    }),
    Event: model('Event', {
      collection: 'events',
      fields: {
        _id: field.objectId(),
        data: field.json(),
      },
    }),
  },
});

const dbName = 'prepare_client';

describe('db.prepare through mongo()', { timeout: timeouts.spinUpMongoMemoryServer }, () => {
  let replSet: MongoMemoryReplSet;
  let client: MongoClient;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      instanceOpts: [
        { launchTimeout: timeouts.spinUpMongoMemoryServer, storageEngine: 'wiredTiger' },
      ],
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    client = new MongoClient(replSet.getUri());
    await client.connect();
    await client
      .db(dbName)
      .collection('accounts')
      .insertMany([
        { email: 'alice@example.com', status: 'active', visits: 3 },
        { email: 'bob@example.com', status: 'active', visits: 7 },
        { email: 'carol@example.com', status: 'new', visits: 1 },
      ]);
  }, timeouts.spinUpMongoMemoryServer);

  afterAll(async () => {
    await client?.close();
    await replSet?.stop();
  }, timeouts.spinUpMongoMemoryServer);

  it('runs a prepared query-builder read against db.runtime()', async () => {
    const db = mongo({ contract, mongoClient: client, dbName });
    const byStatus = await db.prepare(
      { status: 'mongo/string@1', skip: 'mongo/int32@1', take: 'mongo/int32@1' },
      (p) =>
        db.query
          .from('accounts')
          .match((f) => f.status.eq(p.status))
          .sort({ email: 1 })
          .skip(p.skip)
          .limit(p.take)
          .build(),
    );
    const runtime = await db.runtime();

    const active = await byStatus.query(runtime, { status: 'active', skip: 0, take: 10 }).toArray();
    expect(active.map((row) => row.email)).toEqual(['alice@example.com', 'bob@example.com']);

    const secondActive = await byStatus
      .query(runtime, { status: 'active', skip: 1, take: 1 })
      .toArray();
    expect(secondActive.map((row) => row.email)).toEqual(['bob@example.com']);
    await db.close();
  });

  it('executes a prepared query-builder update against db.runtime()', async () => {
    const db = mongo({ contract, mongoClient: client, dbName });
    const promote = await db.prepare({ from: 'mongo/string@1', to: 'mongo/string@1' }, (p) =>
      db.query
        .from('accounts')
        .match((f) => f.status.eq(p.from))
        .updateMany((f) => [f.status.set(p.to)]),
    );
    const runtime = await db.runtime();

    await expect(promote.execute(runtime, { from: 'new', to: 'active' })).resolves.toEqual({
      affectedRows: 1,
    });
    expect(
      await client.db(dbName).collection('accounts').countDocuments({ status: 'active' }),
    ).toBe(3);
    await db.close();
  });

  it('refuses a placeholder in an ORM write to a JSON field, and writes nothing', async () => {
    const db = mongo({ contract, mongoClient: client, dbName });
    const placeholder = new MongoPreparedParamRef('data', 'mongo/json@1', false);

    await expect(
      db.orm.events.create({ data: placeholder as unknown as Record<string, never> }),
    ).rejects.toMatchObject({ code: 'ORM.ARGUMENT_INVALID', meta: { name: 'data' } });
    expect(await client.db(dbName).collection('events').countDocuments()).toBe(0);
    await db.close();
  });
});
