import type {
  RuntimeTargetDescriptor,
  RuntimeTargetInstance,
} from '@internal/framework-components/execution';
import { type MongoCodecRegistry, newMongoCodecRegistry } from '@internal/mongo-codec';
import { mongoTargetDescriptorMeta } from '../core/descriptor-meta';

export interface MongoRuntimeTargetInstance extends RuntimeTargetInstance<'mongo', 'mongo'> {}

/**
 * Target-mongo deliberately does NOT import `MongoRuntimeTargetDescriptor` from `@internal/mongo-runtime`. The target package is a control-plane residence and must not pull the Mongo execution-plane package into its dependency closure. The runtime descriptor here is shaped to satisfy the framework's `RuntimeTargetDescriptor` plus the structural `MongoStaticContributions` (`codecs`) that `@internal/mongo-runtime`
 * consumers narrow to at composition time.
 */
const mongoRuntimeTargetDescriptor: RuntimeTargetDescriptor<
  'mongo',
  'mongo',
  MongoRuntimeTargetInstance
> & {
  readonly codecs: () => MongoCodecRegistry;
} = {
  ...mongoTargetDescriptorMeta,
  // The target owns the codecs; the adapter's runtime descriptor registers them, as the Postgres adapter does.
  codecs: () => newMongoCodecRegistry(),
  create(): MongoRuntimeTargetInstance {
    return {
      familyId: 'mongo',
      targetId: 'mongo',
    };
  },
};

export default mongoRuntimeTargetDescriptor;
