import { mongoFamilyDescriptor } from '@internal/family-mongo/control';
import type { ControlDriverInstance } from '@internal/framework-components/control';
import { createControlStack } from '@internal/framework-components/control';
import { InsertOneCommand } from '@internal/mongo-query-ast/execution';
import { MongoParamRef } from '@internal/mongo-value';
import { mongoTargetDescriptor } from '@internal/target-mongo/control';
import { describe, expect, it } from 'vitest';
import mongoAdapterDescriptor from '../src/exports/control';
import { shoutExtension } from './fixtures/shout-extension';

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
          title: new MongoParamRef('hi', { codecId: 'mongo/string@1' }),
        }),
        meta: { target: 'mongo', storageHash: 'test', lane: 'mongo' },
      },
      {},
    );

    expect(command).toMatchObject({ document: { text: 'HELLO', title: 'hi' } });
  });
});
