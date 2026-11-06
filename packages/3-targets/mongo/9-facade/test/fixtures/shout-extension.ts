import type { ExtensionPackRef } from '@internal/framework-components/components';
import { mongoCodec, mongoCodecDescriptor } from '@internal/mongo-codec';
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
  fromDataTypeValue: (value) => String(value.value),
});

type ShoutCodecTypes = {
  readonly 'shout/text@1': { readonly input: string; readonly output: string };
};

const shoutPackMeta = {
  kind: 'extension',
  id: 'shout',
  familyId: 'mongo',
  targetId: 'mongo',
  version: '0.0.1',
  dataTypes: [shoutType],
  types: {
    codecTypes: { codecDescriptors: [mongoCodecDescriptor(shoutCodec, { traits: ['equality'] })] },
  },
} as const satisfies ExtensionPackRef<'mongo', 'mongo'>;

export const shoutPack: typeof shoutPackMeta & { readonly __codecTypes?: ShoutCodecTypes } =
  shoutPackMeta;

export const shoutRuntime: MongoRuntimeExtensionDescriptor<'mongo'> = {
  ...shoutPackMeta,
  create: () => ({ familyId: 'mongo', targetId: 'mongo' }),
};
