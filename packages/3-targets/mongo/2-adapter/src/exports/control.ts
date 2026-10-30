import type { MongoControlAdapterDescriptor } from '@internal/family-mongo/control-adapter';
import type { MongoControlDriverInstance } from '@internal/mongo-lowering';

export { introspectSchema } from '../core/introspect-schema';
export { MongoInspectionExecutor } from '../core/migrations/inspection-executor';
export { MongoControlAdapterImpl } from '../core/migrations/mongo-control-adapter';
export { extractDb, isMongoControlDriver } from '../core/migrations/mongo-control-driver';
export { createMongoAdapter } from '../mongo-adapter';
export type { MongoControlDriverInstance };

import { MongoControlAdapterImpl } from '../core/migrations/mongo-control-adapter';

export const mongoAdapterDescriptor: MongoControlAdapterDescriptor<'mongo'> = {
  kind: 'adapter',
  id: 'mongo',
  familyId: 'mongo',
  targetId: 'mongo',
  version: '0.0.1',
  types: {
    codecTypes: {
      import: {
        package: '@internal/target-mongo/codec-types',
        named: 'CodecTypes',
        alias: 'MongoCodecTypes',
      },
      parameterizedOutputTypes: {
        package: '@internal/target-mongo/codec-types',
        named: 'ParameterizedOutputTypesForTypeParams',
        alias: 'MongoParameterizedOutputTypes',
      },
    },
  },
  create(_stack) {
    return new MongoControlAdapterImpl();
  },
};

export default mongoAdapterDescriptor;
