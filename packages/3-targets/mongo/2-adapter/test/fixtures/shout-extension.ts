import { type DataTypeValue, dataType, readJsonString } from '@internal/framework-components/codec';
import { mongoCodec, mongoCodecDescriptor } from '@internal/mongo-codec';

const shoutType = dataType('shout/text', {
  read: (json) => readJsonString('shout/text', json),
});

export const shoutExtension = {
  kind: 'extension',
  id: 'shout',
  familyId: 'mongo',
  targetId: 'mongo',
  version: '0.0.1',
  dataTypes: [shoutType],
  types: {
    codecTypes: {
      codecDescriptors: [
        mongoCodecDescriptor(
          mongoCodec({
            typeId: 'shout/text@1',
            dataType: shoutType,
            toWire: (value: string) => value.toUpperCase(),
            fromWire: (wire: string) => wire.toLowerCase(),
            fromDataTypeValue: (value: DataTypeValue<string>) => value.value,
          }),
          { traits: ['equality'] },
        ),
      ],
    },
  },
  create: () => ({ familyId: 'mongo' as const, targetId: 'mongo' as const }),
} as const;
