import type { MongoControlAdapterDescriptor } from '@internal/family-mongo/control-adapter';
import type { AuthoringTypeNamespace } from '@internal/framework-components/authoring';
import type { MongoControlDriverInstance } from '@internal/mongo-lowering';
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
} from '@internal/target-mongo/codec-ids';

export { MongoInspectionExecutor } from '../core/inspection-executor';
export { introspectSchema } from '../core/introspect-schema';
export { MongoControlAdapterImpl } from '../core/mongo-control-adapter';
export { extractDb, isMongoControlDriver } from '../core/mongo-control-driver';
export { createMongoAdapter } from '../mongo-adapter';
export type { MongoControlDriverInstance };

import { MongoControlAdapterImpl } from '../core/mongo-control-adapter';

/**
 * The base PSL scalars as zero-arg type constructors in the unified authoring
 * channel, with explicit `nativeType` values pinned to the codec manifests
 * (`codecLookup.targetTypesFor(codecId)[0]`). `Json` has no BSON type; its
 * `nativeType` names the codec, and the validator reads the codec's empty
 * `targetTypes`, not this value.
 */
export const mongoScalarAuthoringTypes = {
  String: {
    kind: 'typeConstructor',
    documentation: 'Text stored as a BSON string.',
    output: { codecId: MONGO_STRING_CODEC_ID, nativeType: 'string' },
  },
  Int: {
    kind: 'typeConstructor',
    documentation: 'A signed 32-bit integer stored as BSON int.',
    output: { codecId: MONGO_INT32_CODEC_ID, nativeType: 'int' },
  },
  Boolean: {
    kind: 'typeConstructor',
    documentation: 'A true or false value stored as BSON bool.',
    output: { codecId: MONGO_BOOLEAN_CODEC_ID, nativeType: 'bool' },
  },
  DateTime: {
    kind: 'typeConstructor',
    documentation: 'A date and time stored as BSON date with millisecond precision.',
    output: { codecId: MONGO_DATE_CODEC_ID, nativeType: 'date' },
  },
  ObjectId: {
    kind: 'typeConstructor',
    documentation: 'A 12-byte MongoDB identifier stored as BSON ObjectId.',
    output: { codecId: MONGO_OBJECTID_CODEC_ID, nativeType: 'objectId' },
  },
  Float: {
    kind: 'typeConstructor',
    documentation: 'A double-precision floating-point number stored as BSON double.',
    output: { codecId: MONGO_DOUBLE_CODEC_ID, nativeType: 'double' },
  },
  Int64: {
    kind: 'typeConstructor',
    documentation: 'A signed 64-bit integer stored as BSON long, read as a bigint.',
    output: { codecId: MONGO_INT64_CODEC_ID, nativeType: 'long' },
  },
  Decimal128: {
    kind: 'typeConstructor',
    documentation:
      'A 128-bit decimal stored as BSON decimal, read as decimal text without an exponent.',
    output: { codecId: MONGO_DECIMAL128_CODEC_ID, nativeType: 'decimal' },
  },
  Binary: {
    kind: 'typeConstructor',
    documentation: 'Bytes stored as BSON binData, read as a Uint8Array.',
    output: { codecId: MONGO_BINARY_CODEC_ID, nativeType: 'binData' },
  },
  Json: {
    kind: 'typeConstructor',
    documentation:
      'Any JSON value, stored as the BSON document, array or scalar it maps to. The collection validator does not constrain its type.',
    output: { codecId: MONGO_JSON_CODEC_ID, nativeType: 'json' },
  },
} as const satisfies AuthoringTypeNamespace;

export const mongoAdapterDescriptor: MongoControlAdapterDescriptor<'mongo'> = {
  kind: 'adapter',
  id: 'mongo',
  familyId: 'mongo',
  targetId: 'mongo',
  version: '0.0.1',
  authoring: { type: mongoScalarAuthoringTypes },
  types: {
    codecTypes: {
      import: {
        package: '@internal/target-mongo/codec-types',
        named: 'CodecTypes',
        alias: 'MongoCodecTypes',
      },
      typeImports: [
        {
          package: '@internal/target-mongo/codec-types',
          named: 'Vector',
          alias: 'Vector',
        },
      ],
    },
  },
  create(_stack) {
    return new MongoControlAdapterImpl();
  },
};

export default mongoAdapterDescriptor;
