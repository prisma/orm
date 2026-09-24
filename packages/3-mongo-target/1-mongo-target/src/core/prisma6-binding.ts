import { TIMESTAMP_NOW_GENERATOR_ID } from '@internal/framework-components/authoring';
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
} from './codec-ids';
import { mongoTargetDescriptorMetaRuntime } from './descriptor-meta-runtime';

/**
 * What the Mongo target supplies to the Prisma 6 schema reader: the datasource provider it reads, the codec each Prisma 6 scalar maps to (the one Prisma 8 PSL gives the same type), the codec `@db.ObjectId` selects, and the generator `now()` and `@updatedAt` lower to.
 */
export const prisma6MongoBinding = {
  target: mongoTargetDescriptorMetaRuntime,
  providers: ['mongodb'],
  scalarCodecIds: {
    String: MONGO_STRING_CODEC_ID,
    Int: MONGO_INT32_CODEC_ID,
    Float: MONGO_DOUBLE_CODEC_ID,
    Boolean: MONGO_BOOLEAN_CODEC_ID,
    DateTime: MONGO_DATE_CODEC_ID,
    BigInt: MONGO_INT64_CODEC_ID,
    Decimal: MONGO_DECIMAL128_CODEC_ID,
    Bytes: MONGO_BINARY_CODEC_ID,
    Json: MONGO_JSON_CODEC_ID,
  },
  objectIdCodecId: MONGO_OBJECTID_CODEC_ID,
  timestampGeneratorId: TIMESTAMP_NOW_GENERATOR_ID,
} as const;
