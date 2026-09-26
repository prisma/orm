import { timestampNowRuntimeGenerator } from '@internal/family-mongo/runtime';
import type {
  ExecutionStack,
  RuntimeAdapterDescriptor,
  RuntimeAdapterInstance,
} from '@internal/framework-components/execution';
import type { MongoCodecRegistry } from '@internal/mongo-codec';
import type { MongoAdapter } from '@internal/mongo-lowering';
import { buildStandardCodecRegistry } from '@internal/target-mongo/codecs';
import { createMongoAdapter } from '../mongo-adapter';

/**
 * adapter-mongo deliberately does NOT import the `MongoRuntimeAdapterDescriptor` type alias from `@internal/mongo-runtime`. The adapter package is downstream of the Mongo runtime package only conceptually; introducing a hard import would create a workspace dependency cycle (`mongo-runtime` consumes the runtime descriptor's `create(stack)` factory; `adapter-mongo` would then need `mongo-runtime` to type the
 * descriptor). The descriptor is shaped to satisfy the framework's `RuntimeAdapterDescriptor` plus the structural `MongoStaticContributions` (`codecs()`) that `@internal/mongo-runtime` narrows to at composition time. This mirrors the `target-postgres` ↔ `sql-runtime` decoupling pattern.
 */

interface MongoRuntimeAdapterInstance
  extends RuntimeAdapterInstance<'mongo', 'mongo'>,
    MongoAdapter {}

const mongoRuntimeAdapterDescriptor: RuntimeAdapterDescriptor<
  'mongo',
  'mongo',
  MongoRuntimeAdapterInstance
> & {
  readonly codecs: () => MongoCodecRegistry;
  readonly mutationDefaultGenerators: () => ReadonlyArray<
    ReturnType<typeof timestampNowRuntimeGenerator>
  >;
} = {
  kind: 'adapter',
  id: 'mongo',
  familyId: 'mongo',
  targetId: 'mongo',
  version: '0.0.1',
  codecs: buildStandardCodecRegistry,
  mutationDefaultGenerators: () => [timestampNowRuntimeGenerator()],
  create(_stack: ExecutionStack<'mongo', 'mongo'>): MongoRuntimeAdapterInstance {
    const adapter = createMongoAdapter();
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
