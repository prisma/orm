import type {
  RuntimeTargetDescriptor,
  RuntimeTargetInstance,
} from '@internal/framework-components/execution';
import { mongoTargetDescriptorMetaRuntime } from '../core/descriptor-meta-runtime';

export interface MongoRuntimeTargetInstance extends RuntimeTargetInstance<'mongo', 'mongo'> {}

/**
 * Target-mongo deliberately does NOT import `MongoRuntimeTargetDescriptor` from `@internal/mongo-runtime`. The target package is a control-plane residence and must not pull the Mongo execution-plane package into its dependency closure. The target's codecs are its codec descriptors in `types.codecTypes.codecDescriptors`, from its descriptor metadata.
 */
const mongoRuntimeTargetDescriptor: RuntimeTargetDescriptor<
  'mongo',
  'mongo',
  MongoRuntimeTargetInstance
> = {
  ...mongoTargetDescriptorMetaRuntime,
  create(): MongoRuntimeTargetInstance {
    return {
      familyId: 'mongo',
      targetId: 'mongo',
    };
  },
};

export default mongoRuntimeTargetDescriptor;
