import type { JsonValue } from '@internal/contract/types';
import type {
  AnyCodecDescriptor,
  Codec,
  DataType,
  DataTypeValue,
} from '@internal/framework-components/codec';
import { dataTypeId } from '@internal/framework-components/codec';
import type { FamilyPackRef, TargetPackRef } from '@internal/framework-components/components';
import { mongoTestCodecDescriptors, mongoTestDataTypes } from '@internal/mongo-contract/test';

const mongoString = dataTypeId('mongo/string');

export const mongoFamilyPack = {
  kind: 'family',
  id: 'mongo',
  familyId: 'mongo',
  version: '0.0.1',
} as const satisfies FamilyPackRef<'mongo'>;

export const mongoTargetPack = {
  kind: 'target',
  id: 'mongo',
  familyId: 'mongo',
  targetId: 'mongo',
  version: '0.0.1',
  defaultNamespaceId: '__unbound__',
  dataTypes: mongoTestDataTypes,
  types: { codecTypes: { codecDescriptors: mongoTestCodecDescriptors } },
  authoring: {
    dataTypes: {
      [mongoString]: {
        written: { kind: 'plain', syntax: 'string', parse: (text) => text },
        print: (value) => String(value),
        documentation: 'Text.',
      },
    },
    textDataTypes: [mongoString],
  },
} as const satisfies TargetPackRef<'mongo', 'mongo'>;

/** An identity codec `codecId` over `dataType`. */
export function identityCodec(codecId: string, dataType: DataType): Codec {
  return {
    id: codecId,
    dataType,
    toWire: async (v: unknown) => v,
    fromWire: async (w: unknown) => w,
    toDataTypeValue: (v: unknown) => dataType.valueFrom(v as JsonValue, {}),
    fromDataTypeValue: (value: DataTypeValue) => value.value,
  };
}

/** A descriptor of an identity codec `codecId` over `dataType`. */
export function identityCodecDescriptor(codecId: string, dataType: DataType): AnyCodecDescriptor {
  return {
    codecId,
    dataType: dataTypeId(dataType.id),
    traits: ['equality'],
    paramsSchema: undefined,
    isParameterized: false,
    factory: () => () => identityCodec(codecId, dataType),
  };
}
