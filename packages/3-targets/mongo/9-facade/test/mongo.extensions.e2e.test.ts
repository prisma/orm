import mongoFamilyPack from '@internal/family-mongo/pack';
import type { CodecDescriptor, DataTypeValue } from '@internal/framework-components/codec';
import type { ExtensionPackRef } from '@internal/framework-components/components';
import { mongoCodec, newMongoCodecRegistry } from '@internal/mongo-codec';
import { mongoDataType } from '@internal/mongo-contract/data-type';
import { defineContract, field, model } from '@internal/mongo-contract-ts/contract-builder';
import type { MongoRuntimeExtensionDescriptor } from '@internal/mongo-runtime';
import mongoTargetPack from '@internal/target-mongo/pack';
import { timeouts } from '@repo/test-utils';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mongo from '../src/runtime/mongo';

const shoutType = mongoDataType('shout/text', {
  bsonTypes: ['string'],
  read: (json) => json,
});

const shoutCodec = mongoCodec({
  typeId: 'shout/text@1',
  dataType: shoutType,
  toWire: (value: string) => `shout:${value.toUpperCase()}`,
  fromWire: (wire: string) => wire.slice('shout:'.length).toLowerCase(),
  fromDataTypeValue: (value: DataTypeValue<string>) => value.value,
});

const shoutDescriptor: CodecDescriptor = {
  codecId: shoutCodec.id,
  dataType: shoutType.id,
  traits: ['equality'],
  paramsSchema: undefined,
  isParameterized: false,
  factory: () => () => shoutCodec,
};

const shoutPack = {
  kind: 'extension',
  id: 'shout',
  familyId: 'mongo',
  targetId: 'mongo',
  version: '0.0.1',
  dataTypes: [shoutType],
  types: { codecTypes: { codecDescriptors: [shoutDescriptor] } },
} as const satisfies ExtensionPackRef<'mongo', 'mongo'>;

const shoutRuntime: MongoRuntimeExtensionDescriptor<'mongo'> = {
  kind: 'extension',
  id: 'shout',
  familyId: 'mongo',
  targetId: 'mongo',
  version: '0.0.1',
  codecs: () => {
    const registry = newMongoCodecRegistry();
    registry.register(shoutCodec);
    return registry;
  },
  create: () => ({ familyId: 'mongo', targetId: 'mongo' }),
};

const contract = defineContract({
  family: mongoFamilyPack,
  target: mongoTargetPack,
  extensions: { shout: shoutPack },
  models: {
    Greeting: model('Greeting', {
      collection: 'greetings',
      fields: { _id: field.objectId(), text: field.scalar('shout/text@1') },
    }),
  },
  roots: { greetings: 'Greeting' },
});

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
