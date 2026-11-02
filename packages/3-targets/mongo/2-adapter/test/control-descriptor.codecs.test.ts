import { mongoFamilyDescriptor } from '@internal/family-mongo/control';
import type { ControlDriverInstance } from '@internal/framework-components/control';
import { createControlStack } from '@internal/framework-components/control';
import { InsertOneCommand } from '@internal/mongo-query-ast/execution';
import { MongoParamRef } from '@internal/mongo-value';
import { mongoTargetDescriptor } from '@internal/target-mongo/control';
import { describe, expect, it } from 'vitest';
import mongoAdapterDescriptor from '../src/exports/control';
import { shoutExtension } from './fixtures/shout-extension';

const OWNER_ID = '507f1f77bcf86cd799439011';

const fakeControlDriver = {
  familyId: 'mongo',
  targetId: 'mongo',
  db: {},
  execute: () => {
    throw new Error('not used');
  },
  close: async () => {},
} as unknown as ControlDriverInstance<'mongo', 'mongo'>;

describe('mongo control adapter descriptor', () => {
  it('lowers migration writes with the codecs of every component in the control stack', async () => {
    const stack = createControlStack({
      family: mongoFamilyDescriptor,
      target: mongoTargetDescriptor,
      adapter: mongoAdapterDescriptor,
      extensions: [shoutExtension],
    });
    const { adapter } = mongoAdapterDescriptor
      .create(stack)
      .createRunnerDependencies(fakeControlDriver);

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
