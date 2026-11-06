import type { JsonValue } from '@internal/contract/types';
import {
  type AnyCodecDescriptor,
  type Codec,
  type CodecLookupWithDescriptors,
  createDataTypeLookup,
  type DataType,
  type DataTypeLookup,
  type DataTypeValue,
  dataTypeId,
  type TypeLookups,
} from '@internal/framework-components/codec';
import { assertDefined } from '@internal/utils/assertions';
import { blindCast } from '@internal/utils/casts';
import { mongoDataType } from './mongo-data-type';

const bsonTypesByCodecId: Record<string, readonly string[]> = {
  'mongo/string@1': ['string'],
  'mongo/int32@1': ['int'],
  'mongo/bool@1': ['bool'],
  'mongo/date@1': ['date'],
  'mongo/objectId@1': ['objectId'],
  'mongo/double@1': ['double'],
  'mongo/int64@1': ['long'],
  'mongo/int64Number@1': ['long'],
  'mongo/decimal128@1': ['decimal'],
  'mongo/binary@1': ['binData'],
  'mongo/vector@1': ['array'],
  'mongo/json@1': ['object', 'array', 'string', 'double', 'int', 'long', 'bool', 'null'],
  'mongo/bson@1': [],
  'test/unconstrained@1': [],
  'test/int-or-long@1': ['int', 'long'],
  'test/number-or-null@1': ['null', 'int'],
  'custom/oid@2': ['objectId'],
  'custom/text@2': ['string'],
};

function dataTypeIdOf(codecId: string): string {
  return codecId.replace(/@\d+$/, '').toLowerCase();
}

/**
 * One MongoDB data type for each codec in {@link mongoTestCodecDescriptors}, for a test pack's `dataTypes`.
 */
export const mongoTestDataTypes: readonly DataType[] = Object.entries(bsonTypesByCodecId).map(
  ([codecId, bsonTypes]) =>
    mongoDataType(dataTypeIdOf(codecId), { read: (json) => json, bsonTypes }),
);

/**
 * A data type lookup for tests: one MongoDB data type for each codec {@link mongoCodecLookup} knows.
 */
export const mongoDataTypeLookup: DataTypeLookup = createDataTypeLookup(mongoTestDataTypes);

/** An identity codec of `id` over its data type in {@link mongoDataTypeLookup}. */
function identityCodec(id: string): Codec | undefined {
  const dataType = mongoDataTypeLookup.get(dataTypeIdOf(id));
  if (dataType === undefined) return undefined;
  return {
    id,
    dataType,
    toWire: async (v: unknown) => v,
    fromWire: async (w: unknown) => w,
    toDataTypeValue: (v: unknown) =>
      dataType.valueFrom(
        blindCast<JsonValue, 'the test codecs hand over JSON application values'>(v),
        {},
      ),
    fromDataTypeValue: (value: DataTypeValue) => value.value,
  };
}

/**
 * Descriptors of identity codecs for the MongoDB codecs and a few test codecs, each representing its own data type in {@link mongoTestDataTypes}, for a test pack's `types.codecTypes.codecDescriptors`.
 */
export const mongoTestCodecDescriptors: readonly AnyCodecDescriptor[] = Object.keys(
  bsonTypesByCodecId,
).map((codecId) => ({
  codecId,
  dataType: dataTypeId(dataTypeIdOf(codecId)),
  traits: ['equality'],
  paramsSchema: undefined,
  isParameterized: false,
  factory: () => () => {
    const codec = identityCodec(codecId);
    assertDefined(codec, `Test codec "${codecId}" has a data type`);
    return codec;
  },
}));

const descriptorsById = new Map(
  mongoTestCodecDescriptors.map((descriptor) => [descriptor.codecId, descriptor]),
);

/**
 * A codec lookup for tests over {@link mongoTestCodecDescriptors}.
 */
export const mongoCodecLookup: CodecLookupWithDescriptors = {
  get(id: string) {
    return descriptorsById.has(id) ? identityCodec(id) : undefined;
  },
  descriptorFor(id: string) {
    return descriptorsById.get(id);
  },
  renderOutputTypeFor: () => undefined,
};

export const mongoTypeLookups: TypeLookups = {
  codecLookup: mongoCodecLookup,
  dataTypeLookup: mongoDataTypeLookup,
};
