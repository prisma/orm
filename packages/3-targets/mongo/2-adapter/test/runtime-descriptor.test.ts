import { type DataTypeValue, dataType, readJsonString } from '@internal/framework-components/codec';
import { mongoCodec, newMongoCodecRegistry } from '@internal/mongo-codec';
import { InsertOneCommand } from '@internal/mongo-query-ast/execution';
import { MongoParamRef } from '@internal/mongo-value';
import mongoRuntimeTarget from '@internal/target-mongo/runtime';
import { describe, expect, it } from 'vitest';
import mongoRuntimeAdapter from '../src/exports/runtime';

const shoutType = dataType('shout/text', {
  read: (json) => readJsonString('shout/text', json),
});

const shoutExtension = {
  kind: 'extension',
  id: 'shout',
  familyId: 'mongo',
  targetId: 'mongo',
  version: '0.0.1',
  codecs: () => {
    const registry = newMongoCodecRegistry();
    registry.register(
      mongoCodec({
        typeId: 'shout/text@1',
        dataType: shoutType,
        toWire: (value: string) => value.toUpperCase(),
        fromWire: (wire: string) => wire.toLowerCase(),
        fromDataTypeValue: (value: DataTypeValue<string>) => value.value,
      }),
    );
    return registry;
  },
  create: () => ({ familyId: 'mongo' as const, targetId: 'mongo' as const }),
} as const;

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
          title: new MongoParamRef('hi', { codecId: 'mongo/string@1' }),
        }),
        meta: { target: 'mongo', storageHash: 'test', lane: 'mongo' },
      },
      {},
    );

    expect(command).toMatchObject({ document: { text: 'HELLO', title: 'hi' } });
  });
});
