import type { ContractField } from '@internal/contract/types';
import {
  type AnyCodecDescriptor,
  type CodecLookup,
  type CodecLookupWithDescriptors,
  createDataTypeLookup,
  type DataTypeLookup,
} from '@internal/framework-components/codec';
import { mongoDataType } from '@internal/mongo-contract/data-type';

const bsonTypesByCodecId: Record<string, readonly string[]> = {
  'mongo/string@1': ['string'],
  'mongo/int32@1': ['int'],
  'mongo/bool@1': ['bool'],
  'mongo/date@1': ['date'],
  'mongo/objectId@1': ['objectId'],
  'mongo/double@1': ['double'],
  'mongo/int64@1': ['long'],
  'mongo/decimal128@1': ['decimal'],
  'mongo/binary@1': ['binData'],
  'mongo/json@1': ['object', 'array', 'string', 'double', 'int', 'long', 'bool', 'null'],
  'test/unconstrained@1': [],
  'mongo/bson@1': [],
  'test/int-or-long@1': ['int', 'long'],
  'test/number-or-null@1': ['null', 'int'],
};

function dataTypeIdOf(codecId: string): string {
  return codecId.replace(/@\d+$/, '').toLowerCase();
}

export const mongoDataTypeLookup: DataTypeLookup = createDataTypeLookup(
  Object.entries(bsonTypesByCodecId).map(([codecId, bsonTypes]) =>
    mongoDataType(dataTypeIdOf(codecId), { bsonTypes }),
  ),
);

export const mongoCodecLookup: CodecLookupWithDescriptors = {
  get(id: string) {
    if (!(id in bsonTypesByCodecId)) return undefined;
    return {
      id,
      encode: async (v: unknown) => v,
      decode: async (w: unknown) => w,
      encodeJson: (v: unknown) => v,
      decodeJson: (j: unknown) => j,
    } as ReturnType<CodecLookup['get']>;
  },
  descriptorFor(id: string) {
    if (!(id in bsonTypesByCodecId)) return undefined;
    return { codecId: id, dataType: dataTypeIdOf(id) } as unknown as AnyCodecDescriptor;
  },
  renderOutputTypeFor: () => undefined,
};

export function scalarField(codecId: string, nullable = false): ContractField {
  return { type: { kind: 'scalar', codecId }, nullable, many: false };
}

export function enumField(codecId: string, enumName: string, nullable = false): ContractField {
  return {
    type: { kind: 'scalar', codecId },
    nullable,
    many: false,
    valueSet: {
      plane: 'domain',
      entityKind: 'enum',
      namespaceId: '__unbound__',
      entityName: enumName,
    },
  };
}

export function arrayField(
  codecId: string,
  nullable = false,
  elementNullable = false,
): ContractField {
  return { type: { kind: 'scalar', codecId }, nullable, many: { elementNullable } };
}

export function arrayEnumField(
  codecId: string,
  enumName: string,
  nullable = false,
  elementNullable = false,
): ContractField {
  return {
    type: { kind: 'scalar', codecId },
    nullable,
    many: { elementNullable },
    valueSet: {
      plane: 'domain',
      entityKind: 'enum',
      namespaceId: '__unbound__',
      entityName: enumName,
    },
  };
}

export function voField(name: string, nullable = false): ContractField {
  return { type: { kind: 'valueObject', name }, nullable, many: false };
}

export function voArrayField(
  name: string,
  nullable = false,
  elementNullable = false,
): ContractField {
  return { type: { kind: 'valueObject', name }, nullable, many: { elementNullable } };
}
