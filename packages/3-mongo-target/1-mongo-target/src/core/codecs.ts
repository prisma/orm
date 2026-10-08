import type { JsonValue } from '@internal/contract/types';
import type {
  CodecDescriptor,
  CodecTrait,
  DataTypeParams,
  DataTypeValue,
} from '@internal/framework-components/codec';
import { floatToJson, readJsonFloat, renderTsLiteral } from '@internal/framework-components/codec';
import {
  type MongoCodec,
  type MongoCodecRegistry,
  mongoCodec,
  newMongoCodecRegistry,
} from '@internal/mongo-codec';
import type { BsonInputValue, BsonValue } from '@internal/mongo-value';
import { blindCast } from '@internal/utils/casts';
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
  decimalTextBigintLiteral,
  decimalTextNumberLiteral,
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
import { mongoTargetError } from './mongo-target-errors';

export const mongoObjectIdCodec = mongoCodec({
  typeId: MONGO_OBJECTID_CODEC_ID,
  dataType: mongoObjectId,
  fromWire: (wire: ObjectId) => wire.toHexString(),
  toWire: (value: string) => objectIdEncode(MONGO_OBJECTID_CODEC_ID, value),
  toDataTypeValue: (value: string) => objectIdToJson(MONGO_OBJECTID_CODEC_ID, value),
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
  toDataTypeValue: floatToJson,
  fromDataTypeValue: (value) => readJsonFloat(MONGO_DOUBLE_CODEC_ID, value.value),
});

export const mongoInt32Codec = mongoCodec({
  typeId: MONGO_INT32_CODEC_ID,
  dataType: mongoInt32,
  fromWire: (wire: number) => wire,
  toWire: (value: number) => int32Encode(MONGO_INT32_CODEC_ID, value),
  toDataTypeValue: (value: number) => int32ToJson(MONGO_INT32_CODEC_ID, value),
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
  toDataTypeValue: (value: Date) => dateToJson(MONGO_DATE_CODEC_ID, value),
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
  toDataTypeValue: (value: bigint) => int64ToJson(MONGO_INT64_CODEC_ID, value),
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
  toDataTypeValue: (value: number) => int64NumberToJson(MONGO_INT64_NUMBER_CODEC_ID, value),
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
  toDataTypeValue: (value: string) => decimal128ToJson(MONGO_DECIMAL128_CODEC_ID, value),
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
  toDataTypeValue: binaryToBase64,
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
  toDataTypeValue: bsonToJson,
  fromDataTypeValue: (value) => readBsonJson(MONGO_BSON_CODEC_ID, value.value),
});

/**
 * The canonical set of Mongo wire-type codecs.
 *
 * Single source of truth for both control- and runtime-plane adapter descriptors. Don't duplicate this list — import it.
 */
export const mongoStandardCodecs = [
  mongoObjectIdCodec,
  mongoStringCodec,
  mongoDoubleCodec,
  mongoInt32Codec,
  mongoBooleanCodec,
  mongoDateCodec,
  mongoVectorCodec,
  mongoInt64Codec,
  mongoInt64NumberCodec,
  mongoDecimal128Codec,
  mongoBinaryCodec,
  mongoJsonCodec,
  mongoBsonCodec,
] as const;

/**
 * Build a {@link CodecDescriptor} for a Mongo wire-type codec.
 *
 * Wraps an existing {@link MongoCodec} instance into a descriptor whose factory hands out the same shared codec, or, for a codec whose data type has parameters, one built for the column's parameters. Mongo's full migration to descriptor-first authoring is tracked under TML-2324; for now the descriptor view is composed from the existing `mongoCodec()` outputs.
 */
function descriptorFor<Id extends string>(
  codec: MongoCodec<Id, readonly CodecTrait[]>,
  metadata: {
    readonly traits: readonly CodecTrait[];
    /** Builds the codec for a column's parameters, for a codec whose data type has parameters. */
    readonly withParams?: (params: DataTypeParams) => MongoCodec<Id, readonly CodecTrait[]>;
    readonly renderOutputType?: (typeParams: Record<string, unknown>) => string | undefined;
    readonly renderValueLiteral?: CodecDescriptor['renderValueLiteral'];
  },
): CodecDescriptor {
  const renderOutputType = blindCast<
    CodecDescriptor['renderOutputType'] | undefined,
    "the descriptor's P is structurally Record<string, unknown> for codecs that take params (Mongo vector); non-parameterized codecs ignore the slot, so no per-codec P leaks into the heterogeneous descriptor list"
  >(metadata.renderOutputType);
  return {
    codecId: codec.id,
    dataType: codec.dataType.id,
    traits: metadata.traits,
    paramsSchema: blindCast<
      CodecDescriptor['paramsSchema'],
      "the codec takes exactly its data type's parameters, and the descriptor list erases each codec's own parameter type"
    >(codec.dataType.params),
    isParameterized: codec.dataType.params !== undefined,
    factory: blindCast<
      CodecDescriptor['factory'],
      'a codec whose type has no parameters is shared by every column'
    >((params: DataTypeParams | undefined) => {
      const built =
        metadata.withParams === undefined || params === undefined
          ? codec
          : metadata.withParams(params);
      return () => built;
    }),
    ...ifDefined('renderOutputType', renderOutputType),
    ...ifDefined('renderValueLiteral', metadata.renderValueLiteral),
  };
}

const renderVectorOutputType = (typeParams: Record<string, unknown>): string | undefined => {
  const length = typeParams['length'];
  if (length === undefined) return undefined;
  if (
    typeof length !== 'number' ||
    !Number.isFinite(length) ||
    !Number.isInteger(length) ||
    length <= 0
  ) {
    throw mongoTargetError(
      'RUNTIME.TYPE_PARAMS_INVALID',
      'renderOutputType: expected positive integer "length" for Vector',
      { meta: { typeName: 'Vector', param: 'length', received: length } },
    );
  }
  return `Vector<${length}>`;
};

/**
 * Mongo wire-type codec descriptors. Static metadata for `traits` and `renderOutputType` lives here (the descriptor shape) — `MongoCodec` itself carries its data type and the four conversion methods (TML-2357).
 */
export const mongoCodecDescriptors: ReadonlyArray<CodecDescriptor> = [
  descriptorFor(mongoObjectIdCodec, {
    traits: ['equality'],
  }),
  descriptorFor(mongoStringCodec, {
    traits: ['equality', 'order', 'textual'],
    renderValueLiteral: renderTsLiteral,
  }),
  descriptorFor(mongoDoubleCodec, {
    traits: ['equality', 'order', 'numeric'],
    renderValueLiteral: (value) => (typeof value === 'number' ? String(value) : undefined),
  }),
  descriptorFor(mongoInt32Codec, {
    traits: ['equality', 'order', 'numeric'],
    renderValueLiteral: renderTsLiteral,
  }),
  descriptorFor(mongoBooleanCodec, {
    traits: ['equality', 'boolean'],
    renderValueLiteral: renderTsLiteral,
  }),
  descriptorFor(mongoDateCodec, {
    traits: ['equality', 'order'],
  }),
  descriptorFor(mongoVectorCodec, {
    traits: ['equality'],
    renderOutputType: renderVectorOutputType,
    withParams: vectorCodec,
  }),
  descriptorFor(mongoInt64Codec, {
    traits: ['equality', 'order', 'numeric'],
    renderValueLiteral: decimalTextBigintLiteral,
  }),
  descriptorFor(mongoInt64NumberCodec, {
    traits: ['equality', 'order', 'numeric'],
    renderValueLiteral: decimalTextNumberLiteral,
  }),
  descriptorFor(mongoDecimal128Codec, {
    traits: ['equality', 'order', 'numeric'],
  }),
  descriptorFor(mongoBinaryCodec, {
    traits: ['equality'],
  }),
  descriptorFor(mongoJsonCodec, {
    traits: [],
  }),
  descriptorFor(mongoBsonCodec, {
    traits: [],
  }),
];

/**
 * Lookup descriptor metadata by codec id — used by tests and for descriptor-side reads of static metadata.
 */
export function mongoDescriptorById(codecId: string): CodecDescriptor | undefined {
  return mongoCodecDescriptors.find((d) => d.codecId === codecId);
}

/**
 * Build a {@link MongoCodecRegistry} preloaded with the standard Mongo wire-type codecs.
 *
 * Single point of truth for adapter-side codec construction: used by the legacy synchronous `createMongoAdapter()` factory and by the runtime adapter descriptor's `codecs()` getter. Userland code obtains a registry via the framework's execution-stack composition (see `createMongoExecutionContext`) instead of calling this directly.
 */
export function buildStandardCodecRegistry(): MongoCodecRegistry {
  const registry = newMongoCodecRegistry();
  for (const codec of mongoStandardCodecs) {
    registry.register(codec);
  }
  return registry;
}
