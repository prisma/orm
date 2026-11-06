import type { RuntimeDriverDescriptor } from '@internal/framework-components/execution';
import { mongoDriverDescriptorMeta } from '../core/descriptor-meta';
import {
  createMongoRuntimeDriver,
  type MongoRuntimeDriver,
} from '../core/runtime/mongo-runtime-driver';

const mongoRuntimeDriverDescriptor: RuntimeDriverDescriptor<
  'mongo',
  'mongo',
  void,
  MongoRuntimeDriver
> = {
  ...mongoDriverDescriptorMeta,
  create: createMongoRuntimeDriver,
};

export default mongoRuntimeDriverDescriptor;
export type { MongoBinding, MongoRuntimeDriver } from '../core/runtime/mongo-runtime-driver';
