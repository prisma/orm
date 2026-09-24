import type { JsonValue } from '@internal/contract/types';
import type { CodecDescriptor, CodecTrait, DataTypeId } from '@internal/framework-components/codec';
import { renderTsLiteral } from '@internal/framework-components/codec';
import {
  type MongoCodec,
  type MongoCodecRegistry,
  mongoCodec,
  newMongoCodecRegistry,
} from '@internal/mongo-codec';
import { ifDefined } from '@internal/utils/defined';
import { type Binary, type Decimal128, type Long, ObjectId } from 'bson';
import {
  binaryDecode,
  binaryDecodeJson,
  binaryEncode,
  binaryEncodeJson,
  decimal128Decode,
  decimal128DecodeJson,
  decimal128Encode,
  decimal128EncodeJson,
  decimalTextBigintLiteral,
  int64Decode,
  int64DecodeJson,
  int64Encode,
  int64EncodeJson,
} from './bson-scalar-helpers';
import {
  MONGO_BINARY_CODEC_ID,
  MONGO_BOOLEAN_CODEC_ID,
  MONGO_DATE_CODEC_ID,
  MONGO_DECIMAL128_CODEC_ID,
  MONGO_DOUBLE_CODEC_ID,
  MONGO_INT32_CODEC_ID,
  MONGO_INT64_CODEC_ID,
  MONGO_JSON_CODEC_ID,
  MONGO_OBJECTID_CODEC_ID,
  MONGO_STRING_CODEC_ID,
  MONGO_VECTOR_CODEC_ID,
} from './codec-ids';
import {
  mongoBinary,
  mongoBool,
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
import { mongoTargetError } from './mongo-target-errors';

export const mongoObjectIdCodec = mongoCodec({
  typeId: MONGO_OBJECTID_CODEC_ID,
  decode: (wire: ObjectId) => wire.toHexString(),
  encode: (value: string) => new ObjectId(value),
});

export const mongoStringCodec = mongoCodec({
  typeId: MONGO_STRING_CODEC_ID,
  decode: (wire: string) => wire,
  encode: (value: string) => value,
});

export const mongoDoubleCodec = mongoCodec({
  typeId: MONGO_DOUBLE_CODEC_ID,
  decode: (wire: number) => wire,
  encode: (value: number) => value,
});

export const mongoInt32Codec = mongoCodec({
  typeId: MONGO_INT32_CODEC_ID,
  decode: (wire: number) => wire,
  encode: (value: number) => value,
});

export const mongoBooleanCodec = mongoCodec({
  typeId: MONGO_BOOLEAN_CODEC_ID,
  decode: (wire: boolean) => wire,
  encode: (value: boolean) => value,
});

export const mongoDateCodec = mongoCodec({
  typeId: MONGO_DATE_CODEC_ID,
  decode: (wire: Date) => wire,
  encode: (value: Date) => value,
  encodeJson: (value: Date) => value.toISOString(),
  decodeJson: (json) => {
    if (typeof json !== 'string') {
      throw mongoTargetError('RUNTIME.DECODE_FAILED', 'expected ISO date string', {
        meta: { codecId: MONGO_DATE_CODEC_ID, received: typeof json },
      });
    }
    return new Date(json);
  },
});

export const mongoVectorCodec = mongoCodec({
  typeId: MONGO_VECTOR_CODEC_ID,
  decode: (wire: readonly number[]) => wire,
  encode: (value: readonly number[]) => value,
});

/**
 * A BSON `long`. The application value is a `bigint`, because a `number` cannot hold the full 64-bit range; its JSON form is decimal text.
 */
export const mongoInt64Codec = mongoCodec({
  typeId: MONGO_INT64_CODEC_ID,
  decode: (wire: Long | number | bigint) => int64Decode(MONGO_INT64_CODEC_ID, wire),
  encode: (value: bigint): Long | number | bigint => int64Encode(MONGO_INT64_CODEC_ID, value),
  encodeJson: (value: bigint) => int64EncodeJson(MONGO_INT64_CODEC_ID, value),
  decodeJson: (json) => int64DecodeJson(MONGO_INT64_CODEC_ID, json),
});

/**
 * A BSON `decimal`. The application value and its JSON form are the same decimal text, written without an exponent.
 */
export const mongoDecimal128Codec = mongoCodec({
  typeId: MONGO_DECIMAL128_CODEC_ID,
  decode: (wire: Decimal128) => decimal128Decode(MONGO_DECIMAL128_CODEC_ID, wire),
  encode: (value: string) => decimal128Encode(MONGO_DECIMAL128_CODEC_ID, value),
  encodeJson: (value: string) => decimal128EncodeJson(MONGO_DECIMAL128_CODEC_ID, value),
  decodeJson: (json) => decimal128DecodeJson(MONGO_DECIMAL128_CODEC_ID, json),
});

/**
 * BSON `binData`. The application value is a `Uint8Array`; its JSON form is unwrapped base64.
 */
export const mongoBinaryCodec = mongoCodec({
  typeId: MONGO_BINARY_CODEC_ID,
  decode: (wire: Binary) => binaryDecode(MONGO_BINARY_CODEC_ID, wire),
  encode: (value: Uint8Array) => binaryEncode(MONGO_BINARY_CODEC_ID, value),
  encodeJson: binaryEncodeJson,
  decodeJson: (json) => binaryDecodeJson(MONGO_BINARY_CODEC_ID, json),
});

/**
 * Any JSON value, stored as the BSON document, array or scalar it maps to.
 */
export const mongoJsonCodec = mongoCodec({
  typeId: MONGO_JSON_CODEC_ID,
  decode: (wire: JsonValue) => wire,
  encode: (value: JsonValue) => value,
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
  mongoDecimal128Codec,
  mongoBinaryCodec,
  mongoJsonCodec,
] as const;

/**
 * Build a {@link CodecDescriptor} for a Mongo wire-type codec.
 *
 * Wraps an existing {@link MongoCodec} instance into a descriptor whose factory hands out the same shared codec. Mongo's full migration to descriptor-first authoring is tracked under TML-2324; for now the descriptor view is composed from the existing `mongoCodec()` outputs.
 */
function descriptorFor<Id extends string>(
  codec: MongoCodec<Id, readonly CodecTrait[]>,
  metadata: {
    readonly dataType: DataTypeId;
    readonly traits: readonly CodecTrait[];
    readonly targetTypes: readonly string[];
    readonly renderOutputType?: (typeParams: Record<string, unknown>) => string | undefined;
    readonly renderValueLiteral?: CodecDescriptor['renderValueLiteral'];
  },
): CodecDescriptor {
  // The descriptor's `P` is structurally `Record<string, unknown>` for codecs that take params (Mongo `vector`); non-parameterized codecs ignore the slot. Cast through `unknown` to fit the `CodecDescriptor` slot's `(params: P) => …` typing without leaking a per-codec `P` into the heterogeneous descriptor list.
  const renderOutputType = metadata.renderOutputType as
    | CodecDescriptor['renderOutputType']
    | undefined;
  return {
    codecId: codec.id,
    dataType: metadata.dataType,
    traits: metadata.traits,
    targetTypes: metadata.targetTypes,
    paramsSchema: undefined as CodecDescriptor['paramsSchema'],
    isParameterized: false,
    factory: (() => () => codec) as CodecDescriptor['factory'],
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
      { meta: { nativeType: 'Vector', param: 'length', received: length } },
    );
  }
  return `Vector<${length}>`;
};

/**
 * Mongo wire-type codec descriptors. Static metadata for `traits`, `targetTypes`, and `renderOutputType` lives here (the descriptor shape) — `MongoCodec` itself is narrow and only carries the four conversion methods (TML-2357).
 */
export const mongoCodecDescriptors: ReadonlyArray<CodecDescriptor> = [
  descriptorFor(mongoObjectIdCodec, {
    dataType: mongoObjectId.id,
    traits: ['equality'],
    targetTypes: ['objectId'],
  }),
  descriptorFor(mongoStringCodec, {
    dataType: mongoString.id,
    traits: ['equality', 'order', 'textual'],
    targetTypes: ['string'],
    renderValueLiteral: renderTsLiteral,
  }),
  descriptorFor(mongoDoubleCodec, {
    dataType: mongoDouble.id,
    traits: ['equality', 'order', 'numeric'],
    targetTypes: ['double'],
    renderValueLiteral: renderTsLiteral,
  }),
  descriptorFor(mongoInt32Codec, {
    dataType: mongoInt32.id,
    traits: ['equality', 'order', 'numeric'],
    targetTypes: ['int'],
    renderValueLiteral: renderTsLiteral,
  }),
  descriptorFor(mongoBooleanCodec, {
    dataType: mongoBool.id,
    traits: ['equality', 'boolean'],
    targetTypes: ['bool'],
    renderValueLiteral: renderTsLiteral,
  }),
  descriptorFor(mongoDateCodec, {
    dataType: mongoDate.id,
    traits: ['equality', 'order'],
    targetTypes: ['date'],
  }),
  descriptorFor(mongoVectorCodec, {
    dataType: mongoVector.id,
    traits: ['equality'],
    targetTypes: ['vector'],
    renderOutputType: renderVectorOutputType,
  }),
  descriptorFor(mongoInt64Codec, {
    dataType: mongoInt64.id,
    traits: ['equality', 'order', 'numeric'],
    targetTypes: ['long'],
    renderValueLiteral: decimalTextBigintLiteral,
  }),
  descriptorFor(mongoDecimal128Codec, {
    dataType: mongoDecimal128.id,
    traits: ['equality', 'order', 'numeric'],
    targetTypes: ['decimal'],
  }),
  descriptorFor(mongoBinaryCodec, {
    dataType: mongoBinary.id,
    traits: ['equality'],
    targetTypes: ['binData'],
  }),
  descriptorFor(mongoJsonCodec, {
    dataType: mongoJson.id,
    traits: [],
    targetTypes: [],
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
