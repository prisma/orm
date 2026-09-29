import mongo from '@internal/mongo/runtime';
import { timeouts } from '@repo/test-utils';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

const y2k = new Date('2000-01-01T00:00:00Z');

describe('Mongo upsert that keeps a create value for a field with an update default', {
  timeout: timeouts.spinUpMongoMemoryServer,
}, () => {
  let replSet: MongoMemoryReplSet;
  let client: MongoClient;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      instanceOpts: [
        { launchTimeout: timeouts.spinUpMongoMemoryServer, storageEngine: 'wiredTiger' },
      ],
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    client = new MongoClient(replSet.getUri(), { monitorCommands: true });
    await client.connect();
  }, timeouts.spinUpMongoMemoryServer);

  afterAll(async () => {
    await client?.close();
    await replSet?.stop();
  }, timeouts.spinUpMongoMemoryServer);

  it('applies every update operator the way a plain upsert does, in one command', async () => {
    const db = mongo<Contract>({ contractJson, mongoClient: client, dbName: 'upsert_pipeline' });
    const commands: string[] = [];
    const listen = (event: { commandName: string }) => commands.push(event.commandName);
    const upsert = () =>
      db.orm.counters.where({ key: 'k' }).upsert({
        create: {
          key: 'k',
          tags: ['a', 'b'],
          scores: [1, 2, 3],
          factor: 2,
          hits: 5,
          updatedAt: y2k,
        },
        update: (u) => [u.tags.addToSet('c'), u.scores.pop(1), u.factor.mul(3)],
      });

    const inserted = await upsert();
    expect(inserted).toMatchObject({ key: 'k', tags: ['c'], factor: 0, hits: 5, updatedAt: y2k });
    expect(inserted.scores).toBeUndefined();

    await client
      .db('upsert_pipeline')
      .collection('counters')
      .updateOne({ key: 'k' }, { $set: { tags: ['a', 'b'], scores: [1, 2, 3], factor: 2 } });
    client.on('commandStarted', listen);
    const updated = await upsert();
    client.off('commandStarted', listen);
    expect(updated).toMatchObject({ key: 'k', tags: ['a', 'b', 'c'], scores: [1, 2], factor: 6 });
    expect(updated.updatedAt.getTime()).toBeGreaterThan(y2k.getTime());
    expect(commands.filter((name) => name === 'findAndModify')).toHaveLength(1);

    const pulled = await db.orm.counters.where({ key: 'k' }).upsert({
      create: { key: 'k', tags: [], scores: [], factor: 1, hits: 0, updatedAt: y2k },
      update: (u) => [u.tags.pull('a'), u.scores.push(9)],
    });
    expect(pulled).toMatchObject({ tags: ['b', 'c'], scores: [1, 2, 9] });
    await db.close();
  });
});
