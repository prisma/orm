import type { CodecDescriptor, DataTypeValue } from '@internal/framework-components/codec';
import type { ExtensionPackRef } from '@internal/framework-components/components';
import { mongoCodec, newMongoCodecRegistry } from '@internal/mongo-codec';
import { mongoDataType } from '@internal/mongo-contract/data-type';
import type { MongoRuntimeExtensionDescriptor } from '@internal/mongo-runtime';

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

export const shoutPack = {
  kind: 'extension',
  id: 'shout',
  familyId: 'mongo',
  targetId: 'mongo',
  version: '0.0.1',
  dataTypes: [shoutType],
  types: { codecTypes: { codecDescriptors: [shoutDescriptor] } },
} as const satisfies ExtensionPackRef<'mongo', 'mongo'>;

export const shoutRuntime: MongoRuntimeExtensionDescriptor<'mongo'> = {
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
