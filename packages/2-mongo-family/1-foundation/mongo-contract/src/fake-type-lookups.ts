import type { JsonValue } from '@internal/contract/types';
import {
  type AnyCodecDescriptor,
  type Codec,
  type CodecLookupWithDescriptors,
  createDataTypeLookup,
  type DataTypeLookup,
  type DataTypeValue,
} from '@internal/framework-components/codec';
import { blindCast } from '@internal/utils/casts';
import { type MongoTypeLookups, mongoDataType } from './mongo-data-type';

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
 * A data type lookup for tests: one MongoDB data type for each codec {@link mongoCodecLookup} knows.
 */
export const mongoDataTypeLookup: DataTypeLookup = createDataTypeLookup(
  Object.entries(bsonTypesByCodecId).map(([codecId, bsonTypes]) =>
    mongoDataType(dataTypeIdOf(codecId), { read: (json) => json, bsonTypes }),
  ),
);

/**
 * A codec lookup for tests: identity codecs for the MongoDB codecs and a few test codecs, each representing its own data type in {@link mongoDataTypeLookup}.
 */
export const mongoCodecLookup: CodecLookupWithDescriptors = {
  get(id: string) {
    if (!(id in bsonTypesByCodecId)) return undefined;
    const dataType = mongoDataTypeLookup.get(dataTypeIdOf(id));
    if (dataType === undefined) return undefined;
    const codec: Codec = {
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
    return codec;
  },
  descriptorFor(id: string) {
    if (!(id in bsonTypesByCodecId)) return undefined;
    return blindCast<
      AnyCodecDescriptor,
      'the derivation and the PSL interpreter read only codecId, dataType and traits'
    >({ codecId: id, dataType: dataTypeIdOf(id), traits: ['equality'] });
  },
  renderOutputTypeFor: () => undefined,
};

export const mongoTypeLookups: MongoTypeLookups = {
  codecLookup: mongoCodecLookup,
  dataTypeLookup: mongoDataTypeLookup,
};
