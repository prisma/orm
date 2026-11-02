import type { JsonValue } from '@internal/contract/types';
import type {
  CodecDescriptor,
  DataTypeParams,
  DataTypeValue,
} from '@internal/framework-components/codec';
import {
  decimalTextBigintLiteral,
  decimalTextNumberLiteral,
  floatNumberLiteral,
  floatToJson,
  readJsonFloat,
  renderTsLiteral,
} from '@internal/framework-components/codec';
import { mongoCodec, mongoCodecDescriptor } from '@internal/mongo-codec';
import type { BsonInputValue, BsonValue } from '@internal/mongo-value';
import { ifDefined } from '@internal/utils/defined';
import type { Binary, Decimal128, Double, Long, ObjectId } from 'bson';
import { bsonToJson, decodeBsonValue, encodeBsonValue, readBsonJson } from './bson-codec-helpers';
import {
  binaryDecode,
  binaryEncode,
  binaryFromBase64,
  binaryToBase64,
  booleanEncode,
  dateEncode,
  dateToJson,
  decimal128Decode,
  decimal128Encode,
  decimal128ToJson,
  doubleEncode,
  int32Encode,
  int32ToJson,
  int64Decode,
  int64Encode,
  int64NumberDecode,
  int64NumberEncode,
  int64NumberFromDigits,
  int64NumberToJson,
  int64ToJson,
  objectIdEncode,
  objectIdToJson,
  stringEncode,
  vectorEncode,
} from './bson-scalar-helpers';
import {
  MONGO_BINARY_CODEC_ID,
  MONGO_BOOLEAN_CODEC_ID,
  MONGO_BSON_CODEC_ID,
  MONGO_DATE_CODEC_ID,
  MONGO_DECIMAL128_CODEC_ID,
  MONGO_DOUBLE_CODEC_ID,
  MONGO_INT32_CODEC_ID,
  MONGO_INT64_CODEC_ID,
  MONGO_INT64_NUMBER_CODEC_ID,
  MONGO_JSON_CODEC_ID,
  MONGO_OBJECTID_CODEC_ID,
  MONGO_STRING_CODEC_ID,
  MONGO_VECTOR_CODEC_ID,
} from './codec-ids';
import {
  mongoBinary,
  mongoBool,
  mongoBson,
  mongoDate,
  mongoDecimal128,
  mongoDouble,
  mongoInt32,
  mongoInt64,
  mongoJson,
  mongoObjectId,
  mongoString,
  mongoVector,
} from './data-types';
import { decodeJsonValue, encodeJsonValue } from './json-codec-helpers';

export const mongoObjectIdCodec = mongoCodec({
  typeId: MONGO_OBJECTID_CODEC_ID,
  dataType: mongoObjectId,
  fromWire: (wire: ObjectId) => wire.toHexString(),
  toWire: (value: string) => objectIdEncode(MONGO_OBJECTID_CODEC_ID, value),
  toDataTypeValue: (value: string) =>
    mongoObjectId.valueFrom(objectIdToJson(MONGO_OBJECTID_CODEC_ID, value), {}),
  fromDataTypeValue: (value: DataTypeValue<string>) => value.value,
});

export const mongoStringCodec = mongoCodec({
  typeId: MONGO_STRING_CODEC_ID,
  dataType: mongoString,
  fromWire: (wire: string) => wire,
  toWire: (value: string) => stringEncode(MONGO_STRING_CODEC_ID, value),
  fromDataTypeValue: (value: DataTypeValue<string>) => value.value,
});

export const mongoDoubleCodec = mongoCodec({
  typeId: MONGO_DOUBLE_CODEC_ID,
  dataType: mongoDouble,
  fromWire: (wire: number | Double) => Number(wire),
  toWire: (value: number): number | Double => doubleEncode(MONGO_DOUBLE_CODEC_ID, value),
  toDataTypeValue: (value: number) => mongoDouble.valueFrom(floatToJson(value), {}),
  fromDataTypeValue: (value) => readJsonFloat(MONGO_DOUBLE_CODEC_ID, value.value),
});

export const mongoInt32Codec = mongoCodec({
  typeId: MONGO_INT32_CODEC_ID,
  dataType: mongoInt32,
  fromWire: (wire: number) => wire,
  toWire: (value: number) => int32Encode(MONGO_INT32_CODEC_ID, value),
  toDataTypeValue: (value: number) =>
    mongoInt32.valueFrom(int32ToJson(MONGO_INT32_CODEC_ID, value), {}),
  fromDataTypeValue: (value: DataTypeValue<number>) => value.value,
});

export const mongoBooleanCodec = mongoCodec({
  typeId: MONGO_BOOLEAN_CODEC_ID,
  dataType: mongoBool,
  fromWire: (wire: boolean) => wire,
  toWire: (value: boolean) => booleanEncode(MONGO_BOOLEAN_CODEC_ID, value),
  fromDataTypeValue: (value: DataTypeValue<boolean>) => value.value,
});

export const mongoDateCodec = mongoCodec({
  typeId: MONGO_DATE_CODEC_ID,
  dataType: mongoDate,
  fromWire: (wire: Date) => wire,
  toWire: (value: Date) => dateEncode(MONGO_DATE_CODEC_ID, value),
  toDataTypeValue: (value: Date) => mongoDate.valueFrom(dateToJson(MONGO_DATE_CODEC_ID, value), {}),
  fromDataTypeValue: (value: DataTypeValue<string>) => new Date(value.value),
});

/** The vector codec for a column of `mongo/vector` with `params`. The dimension reaches only the TypeScript type `Vector<n>`. */
function vectorCodec(params?: DataTypeParams) {
  return mongoCodec({
    typeId: MONGO_VECTOR_CODEC_ID,
    dataType: mongoVector,
    ...ifDefined('params', params),
    fromWire: (wire: readonly number[]) => wire,
    toWire: (value: readonly number[]) => vectorEncode(MONGO_VECTOR_CODEC_ID, value),
    fromDataTypeValue: (value: DataTypeValue<readonly number[]>) => value.value,
  });
}

export const mongoVectorCodec = vectorCodec();

/**
 * A BSON `long`. The application value is a `bigint`, because a `number` cannot hold the full 64-bit range; its stored form is decimal text.
 */
export const mongoInt64Codec = mongoCodec({
  typeId: MONGO_INT64_CODEC_ID,
  dataType: mongoInt64,
  fromWire: (wire: Long | number | bigint) => int64Decode(MONGO_INT64_CODEC_ID, wire),
  toWire: (value: bigint): Long | number | bigint => int64Encode(MONGO_INT64_CODEC_ID, value),
  toDataTypeValue: (value: bigint) =>
    mongoInt64.valueFrom(int64ToJson(MONGO_INT64_CODEC_ID, value), {}),
  fromDataTypeValue: (value: DataTypeValue<string>) => BigInt(value.value),
});

/**
 * A BSON `long` read and written as a `number` from -(2^53 - 1) to 2^53 - 1, the value a Prisma 6 `Int` presents. A value outside that range, or with a fraction, is refused rather than rounded.
 */
export const mongoInt64NumberCodec = mongoCodec({
  typeId: MONGO_INT64_NUMBER_CODEC_ID,
  dataType: mongoInt64,
  fromWire: (wire: Long | number | bigint) => int64NumberDecode(MONGO_INT64_NUMBER_CODEC_ID, wire),
  toWire: (value: number): Long | number | bigint =>
    int64NumberEncode(MONGO_INT64_NUMBER_CODEC_ID, value),
  toDataTypeValue: (value: number) =>
    mongoInt64.valueFrom(int64NumberToJson(MONGO_INT64_NUMBER_CODEC_ID, value), {}),
  fromDataTypeValue: (value) => int64NumberFromDigits(MONGO_INT64_NUMBER_CODEC_ID, value.value),
});

/**
 * A BSON `decimal`. The application value and its stored form are the same decimal text, written without an exponent.
 */
export const mongoDecimal128Codec = mongoCodec({
  typeId: MONGO_DECIMAL128_CODEC_ID,
  dataType: mongoDecimal128,
  fromWire: (wire: Decimal128) => decimal128Decode(MONGO_DECIMAL128_CODEC_ID, wire),
  toWire: (value: string) => decimal128Encode(MONGO_DECIMAL128_CODEC_ID, value),
  toDataTypeValue: (value: string) =>
    mongoDecimal128.valueFrom(decimal128ToJson(MONGO_DECIMAL128_CODEC_ID, value), {}),
  fromDataTypeValue: (value: DataTypeValue<string>) => value.value,
});

/**
 * BSON `binData`. The application value is a `Uint8Array`; its stored form is unwrapped base64.
 */
export const mongoBinaryCodec = mongoCodec({
  typeId: MONGO_BINARY_CODEC_ID,
  dataType: mongoBinary,
  fromWire: (wire: Binary | Uint8Array) => binaryDecode(MONGO_BINARY_CODEC_ID, wire),
  toWire: (value: Uint8Array) => binaryEncode(MONGO_BINARY_CODEC_ID, value),
  toDataTypeValue: (value: Uint8Array) => mongoBinary.valueFrom(binaryToBase64(value), {}),
  fromDataTypeValue: (value: DataTypeValue<string>) => binaryFromBase64(value.value),
});

/**
 * A JSON value, stored as the BSON object, array, string, number, boolean or null it maps to. Encode and decode refuse any other value at any depth, naming its path.
 */
export const mongoJsonCodec = mongoCodec({
  typeId: MONGO_JSON_CODEC_ID,
  dataType: mongoJson,
  fromWire: (wire: JsonValue) => decodeJsonValue(wire),
  toWire: (value: JsonValue) => encodeJsonValue(value),
});

/**
 * Any BSON value, passed through unchanged except that decode turns a `DBRef` back into the `{ $ref, $id }` document it was stored as. Encode takes a `BsonInputValue` and decode returns a `BsonValue`. Its stored form is canonical MongoDB Extended JSON v2, written with each number and `Uint8Array` as the BSON type the driver stores, so a round trip keeps the BSON bytes but may return wrapper classes such as `Int32` and `Double`.
 */
export const mongoBsonCodec = mongoCodec<
  typeof MONGO_BSON_CODEC_ID,
  readonly [],
  BsonInputValue,
  BsonInputValue,
  BsonValue
>({
  typeId: MONGO_BSON_CODEC_ID,
  dataType: mongoBson,
  fromWire: (wire: BsonInputValue) => decodeBsonValue(wire),
  toWire: (value: BsonInputValue) => encodeBsonValue(value),
  toDataTypeValue: (value: BsonInputValue) => mongoBson.valueFrom(bsonToJson(value), {}),
  fromDataTypeValue: (value) => readBsonJson(MONGO_BSON_CODEC_ID, value.value),
});

/**
 * Mongo wire-type codec descriptors. Static metadata such as `traits` lives here (the descriptor shape) — `MongoCodec` itself carries its data type and the four conversion methods (TML-2357).
 */
export const mongoCodecDescriptors: ReadonlyArray<CodecDescriptor> = [
  mongoCodecDescriptor(mongoObjectIdCodec, {
    traits: ['equality'],
  }),
  mongoCodecDescriptor(mongoStringCodec, {
    traits: ['equality', 'order', 'textual'],
    renderValueLiteral: renderTsLiteral,
  }),
  mongoCodecDescriptor(mongoDoubleCodec, {
    traits: ['equality', 'order', 'numeric'],
    renderValueLiteral: floatNumberLiteral,
  }),
  mongoCodecDescriptor(mongoInt32Codec, {
    traits: ['equality', 'order', 'numeric'],
    renderValueLiteral: renderTsLiteral,
  }),
  mongoCodecDescriptor(mongoBooleanCodec, {
    traits: ['equality', 'boolean'],
    renderValueLiteral: renderTsLiteral,
  }),
  mongoCodecDescriptor(mongoDateCodec, {
    traits: ['equality', 'order'],
  }),
  mongoCodecDescriptor(mongoVectorCodec, {
    traits: ['equality'],
    withParams: vectorCodec,
  }),
  mongoCodecDescriptor(mongoInt64Codec, {
    traits: ['equality', 'order', 'numeric'],
    renderValueLiteral: decimalTextBigintLiteral,
  }),
  mongoCodecDescriptor(mongoInt64NumberCodec, {
    traits: ['equality', 'order', 'numeric'],
    renderValueLiteral: decimalTextNumberLiteral,
  }),
  mongoCodecDescriptor(mongoDecimal128Codec, {
    traits: ['equality', 'order', 'numeric'],
    keepsWrittenForm: true,
  }),
  mongoCodecDescriptor(mongoBinaryCodec, {
    traits: ['equality'],
  }),
  mongoCodecDescriptor(mongoJsonCodec, {
    traits: [],
  }),
  mongoCodecDescriptor(mongoBsonCodec, {
    traits: [],
  }),
];

/**
 * Lookup descriptor metadata by codec id — used by tests and for descriptor-side reads of static metadata.
 */
export function mongoDescriptorById(codecId: string): CodecDescriptor | undefined {
  return mongoCodecDescriptors.find((d) => d.codecId === codecId);
}
