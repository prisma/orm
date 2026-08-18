import type { AnyCodecDescriptor } from '@internal/framework-components/codec';
import type {
  RuntimeTargetDescriptor,
  RuntimeTargetInstance,
} from '@internal/framework-components/execution';
import { postgresTargetDescriptorMetaRuntime } from '../core/descriptor-meta-runtime';

export { INSTANT_NOW_GENERATOR_ID, instantNow } from '../core/instant-now-generator';
export { PostgresContractSerializer } from '../core/postgres-contract-serializer';
export { PostgresContractView } from '../core/postgres-contract-view';

export interface PostgresRuntimeTargetInstance extends RuntimeTargetInstance<'sql', 'postgres'> {}

/**
 * Target-postgres deliberately does NOT import `SqlRuntimeTargetDescriptor` from `@internal/sql-runtime`. The target package is a control-plane residence and must not pull the SQL execution-plane package into its dependency closure. The runtime descriptor here is shaped to satisfy the framework's `RuntimeTargetDescriptor` plus the structural `SqlStaticContributions` (`codecs:` returning a descriptor list) that
 * `@internal/sql-runtime` consumers narrow to at composition time.
 *
 * The target itself contributes no codecs — postgres-specific codecs ship from the postgres adapter and from extension packs (pgvector, arktype-json, etc.).
 */
const postgresRuntimeTargetDescriptor: RuntimeTargetDescriptor<
  'sql',
  'postgres',
  PostgresRuntimeTargetInstance
> & {
  readonly codecs: () => readonly AnyCodecDescriptor[];
} = {
  ...postgresTargetDescriptorMetaRuntime,
  codecs: () => [],
  create(): PostgresRuntimeTargetInstance {
    return {
      familyId: 'sql',
      targetId: 'postgres',
    };
  },
};

export default postgresRuntimeTargetDescriptor;
