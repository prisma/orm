import { TIMESTAMP_NOW_GENERATOR_ID } from '@internal/framework-components/authoring';
import type { TargetPackRef } from '@internal/framework-components/components';
import {
  MONGO_BINARY_CODEC_ID,
  MONGO_BOOLEAN_CODEC_ID,
  MONGO_DATE_CODEC_ID,
  MONGO_DECIMAL128_CODEC_ID,
  MONGO_DOUBLE_CODEC_ID,
  MONGO_INT32_CODEC_ID,
  MONGO_INT64_CODEC_ID,
  MONGO_INT64_NUMBER_CODEC_ID,
  MONGO_JSON_CODEC_ID,
  MONGO_OBJECTID_CODEC_ID,
  MONGO_STRING_CODEC_ID,
} from './codec-ids';
import { mongoTargetDescriptorMetaRuntime } from './descriptor-meta-runtime';

const target: TargetPackRef<'mongo', 'mongo'> = mongoTargetDescriptorMetaRuntime;

/**
 * What the Mongo target supplies to the Prisma 6 schema reader: the datasource provider it reads, the codec each Prisma 6 scalar and native type maps to, the codec an `@id` must have, and the generator `now()` and `@updatedAt` lower to. Each codec is the one for the BSON type Prisma 6 stores (ADR 257), with the application type the Prisma 6 client presents: a plain `Int` is a BSON long read as a `number`.
 */
export const prisma6MongoBinding = {
  target,
  providers: ['mongodb'],
  scalarCodecIds: {
    String: MONGO_STRING_CODEC_ID,
    Int: MONGO_INT64_NUMBER_CODEC_ID,
    Float: MONGO_DOUBLE_CODEC_ID,
    Boolean: MONGO_BOOLEAN_CODEC_ID,
    DateTime: MONGO_DATE_CODEC_ID,
    BigInt: MONGO_INT64_CODEC_ID,
    Decimal: MONGO_DECIMAL128_CODEC_ID,
    Bytes: MONGO_BINARY_CODEC_ID,
    Json: MONGO_JSON_CODEC_ID,
  },
  nativeTypeCodecIds: {
    String: { 'db.String': MONGO_STRING_CODEC_ID, 'db.ObjectId': MONGO_OBJECTID_CODEC_ID },
    Boolean: { 'db.Bool': MONGO_BOOLEAN_CODEC_ID },
    Int: { 'db.Int': MONGO_INT32_CODEC_ID, 'db.Long': MONGO_INT64_NUMBER_CODEC_ID },
    BigInt: { 'db.Long': MONGO_INT64_CODEC_ID },
    Float: { 'db.Double': MONGO_DOUBLE_CODEC_ID },
    DateTime: { 'db.Date': MONGO_DATE_CODEC_ID },
    Bytes: { 'db.BinData': MONGO_BINARY_CODEC_ID, 'db.ObjectId': MONGO_OBJECTID_CODEC_ID },
    Json: { 'db.Json': MONGO_JSON_CODEC_ID },
  },
  objectIdCodecId: MONGO_OBJECTID_CODEC_ID,
  timestampGeneratorId: TIMESTAMP_NOW_GENERATOR_ID,
} as const;
