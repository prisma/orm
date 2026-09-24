import type { MongoControlAdapterDescriptor } from '@internal/family-mongo/control-adapter';
import type { AuthoringTypeNamespace } from '@internal/framework-components/authoring';
import type { MongoControlDriverInstance } from '@internal/mongo-lowering';
import {
  MONGO_BOOLEAN_CODEC_ID,
  MONGO_DATE_CODEC_ID,
  MONGO_DOUBLE_CODEC_ID,
  MONGO_INT32_CODEC_ID,
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
 * (`codecLookup.targetTypesFor(codecId)[0]`).
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
