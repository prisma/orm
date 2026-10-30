import type { JsonValue } from '@internal/contract/types';
import type { AuthoringTypeNamespace } from '@internal/framework-components/authoring';
import type {
  AnyCodecDescriptor,
  Codec,
  DataType,
  DataTypeValue,
} from '@internal/framework-components/codec';
import { dataTypeId } from '@internal/framework-components/codec';
import type { FamilyPackRef, TargetPackRef } from '@internal/framework-components/components';
import { mongoTestCodecDescriptors, mongoTestDataTypes } from '@internal/mongo-contract/test';
import { createContractAuthoringHelpers } from '../src/contract-builder';

const mongoString = dataTypeId('mongo/string');
const mongoInt32 = dataTypeId('mongo/int32');

const scalar = <const CodecId extends string>(codecId: CodecId) =>
  ({ kind: 'typeConstructor', output: { codecId } }) as const;

/** The MongoDB scalar type constructors, as the target contributes them. */
export const mongoTestScalarTypes = {
  String: scalar('mongo/string@1'),
  Int32: scalar('mongo/int32@1'),
  Bool: scalar('mongo/bool@1'),
  Date: scalar('mongo/date@1'),
  ObjectId: scalar('mongo/objectId@1'),
  Double: scalar('mongo/double@1'),
  Int64: scalar('mongo/int64@1'),
  Int64Number: scalar('mongo/int64Number@1'),
  Decimal128: scalar('mongo/decimal128@1'),
  Binary: scalar('mongo/binary@1'),
  Json: scalar('mongo/json@1'),
  Bson: scalar('mongo/bson@1'),
  Int: { ...scalar('mongo/int32@1'), deprecated: { replacement: 'Int32' } },
  Float: { ...scalar('mongo/double@1'), deprecated: { replacement: 'Double' } },
  Boolean: { ...scalar('mongo/bool@1'), deprecated: { replacement: 'Bool' } },
  DateTime: { ...scalar('mongo/date@1'), deprecated: { replacement: 'Date' } },
  Vector: {
    kind: 'typeConstructor',
    args: [{ kind: 'value', dataType: 'mongo/int32', name: 'length', optional: true }],
    output: { codecId: 'mongo/vector@1', typeParams: { length: { kind: 'arg', index: 0 } } },
  },
} as const satisfies AuthoringTypeNamespace;

export const mongoFamilyPack = {
  kind: 'family',
  id: 'mongo',
  familyId: 'mongo',
  version: '0.0.1',
} as const satisfies FamilyPackRef<'mongo'>;

const mongoTargetPackBase = {
  kind: 'target',
  id: 'mongo',
  familyId: 'mongo',
  targetId: 'mongo',
  version: '0.0.1',
  defaultNamespaceId: '__unbound__',
  dataTypes: mongoTestDataTypes,
  types: { codecTypes: { codecDescriptors: mongoTestCodecDescriptors } },
  authoring: {
    type: mongoTestScalarTypes,
    dataTypes: {
      [mongoString]: {
        written: { kind: 'plain', syntax: 'string', parse: (text) => text },
        print: (value) => String(value),
        documentation: 'Text.',
      },
      [mongoInt32]: {
        written: {
          kind: 'plain',
          syntax: 'number',
          types: [mongoInt32],
          classify: (text) => ({ type: mongoInt32, value: Number(text) }),
        },
        print: (value) => String(value),
        documentation: 'A number.',
      },
    },
    textDataTypes: [mongoString],
  },
} as const satisfies TargetPackRef<'mongo', 'mongo'>;

export const mongoTargetPack: typeof mongoTargetPackBase & {
  readonly __dataTypeArguments?: {
    readonly 'mongo/int32': { readonly argument: number; readonly parameter: number };
  };
} = mongoTargetPackBase;

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

/** The `type` helpers of the test packs, for fields declared outside a `defineContract` callback. */
export const { type } = createContractAuthoringHelpers({
  family: mongoFamilyPack,
  target: mongoTargetPack,
});
