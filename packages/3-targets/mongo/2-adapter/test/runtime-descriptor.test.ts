import { InsertOneCommand } from '@internal/mongo-query-ast/execution';
import { MongoParamRef } from '@internal/mongo-value';
import mongoRuntimeTarget from '@internal/target-mongo/runtime';
import { describe, expect, it } from 'vitest';
import mongoRuntimeAdapter from '../src/exports/runtime';
import { shoutExtension } from './fixtures/shout-extension';

const OWNER_ID = '507f1f77bcf86cd799439011';

describe('mongo runtime adapter descriptor', () => {
  it('encodes with the codecs of every component in the stack it is created for', async () => {
    const adapter = mongoRuntimeAdapter.create({
      target: mongoRuntimeTarget,
      adapter: mongoRuntimeAdapter,
      extensions: [shoutExtension],
    });

    const command = await adapter.lower(
      {
        collection: 'greetings',
        command: new InsertOneCommand('greetings', {
          text: new MongoParamRef('hello', { codecId: 'shout/text@1' }),
          ownerId: new MongoParamRef(OWNER_ID, { codecId: 'mongo/objectId@1' }),
        }),
        meta: { target: 'mongo', storageHash: 'test', lane: 'mongo' },
      },
      {},
    );

    expect(command).toMatchObject({
      document: {
        text: 'HELLO',
        ownerId: expect.objectContaining({ _bsontype: 'ObjectId' }),
      },
    });
    expect(String(Reflect.get(Reflect.get(command, 'document'), 'ownerId'))).toBe(OWNER_ID);
  });
});
