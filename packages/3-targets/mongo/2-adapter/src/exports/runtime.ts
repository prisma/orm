import { timestampNowRuntimeGenerator } from '@internal/family-mongo/runtime';
import { composeMongoCodecRegistry } from '@internal/mongo-codec';
import type {
  MongoExecutionStack,
  MongoRuntimeAdapterDescriptor,
  MongoRuntimeAdapterInstance,
} from '@internal/mongo-runtime';
import { buildStandardCodecRegistry } from '@internal/target-mongo/codecs';
import { createMongoAdapter } from '../mongo-adapter';

const mongoRuntimeAdapterDescriptor: MongoRuntimeAdapterDescriptor<
  'mongo',
  MongoRuntimeAdapterInstance<'mongo'>
> = {
  kind: 'adapter',
  id: 'mongo',
  familyId: 'mongo',
  targetId: 'mongo',
  version: '0.0.1',
  codecs: buildStandardCodecRegistry,
  mutationDefaultGenerators: () => [timestampNowRuntimeGenerator()],
  create(stack: MongoExecutionStack<'mongo'>): MongoRuntimeAdapterInstance<'mongo'> {
    const adapter = createMongoAdapter(
      composeMongoCodecRegistry([stack.target, stack.adapter, ...stack.extensions]),
    );
    return {
      familyId: 'mongo' as const,
      targetId: 'mongo' as const,
      lower: adapter.lower.bind(adapter),
      structuralLower: adapter.structuralLower.bind(adapter),
      resolveParams: adapter.resolveParams.bind(adapter),
    };
  },
};

export default mongoRuntimeAdapterDescriptor;
