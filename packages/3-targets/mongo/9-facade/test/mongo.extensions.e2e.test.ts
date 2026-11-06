import { timeouts } from '@repo/test-utils';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defineContract } from '../src/exports/contract-builder';
import mongo from '../src/runtime/mongo';
import { shoutPack, shoutRuntime } from './fixtures/shout-extension';

const contract = defineContract({ extensions: { shout: shoutPack } }, ({ field, model }) => ({
  models: {
    Greeting: model('Greeting', {
      collection: 'greetings',
      fields: { _id: field.objectId(), text: field.scalar('shout/text@1') },
    }),
  },
  roots: { greetings: 'Greeting' },
}));

describe('mongo() with extensions', { timeout: timeouts.spinUpMongoMemoryServer }, () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
  }, timeouts.spinUpMongoMemoryServer);

  afterAll(async () => {
    await replSet?.stop();
  }, timeouts.spinUpMongoMemoryServer);

  it('refuses a contract that requires an extension it is not given', () => {
    expect(() => mongo({ contract, uri: replSet.getUri(), dbName: 'ext_missing' })).toThrow(
      expect.objectContaining({ code: 'RUNTIME.MISSING_EXTENSION_PACK' }),
    );
  });

  it(
    'writes and reads a field through a codec the extension contributes',
    async () => {
      const db = mongo({
        contract,
        uri: replSet.getUri(),
        dbName: 'ext_round_trip',
        extensions: [shoutRuntime],
      });
      const client = new MongoClient(replSet.getUri());
      try {
        await db.orm.greetings.create({ text: 'hello' });

        const stored = await client.db('ext_round_trip').collection('greetings').findOne({});
        expect(stored?.['text']).toBe('shout:HELLO');

        const read = await db.orm.greetings.first();
        expect(read?.text).toBe('hello');
      } finally {
        await client.close();
        await db.close();
      }
    },
    timeouts.spinUpMongoMemoryServer,
  );
});
