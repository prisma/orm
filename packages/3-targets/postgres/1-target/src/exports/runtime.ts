import type { AnyCodecDescriptor } from '@internal/framework-components/codec';
import type {
  RuntimeTargetDescriptor,
  RuntimeTargetInstance,
} from '@internal/framework-components/execution';
import type { SqlOperationDescriptors } from '@internal/sql-operations';
import type { CollectionMethodContribution } from '@internal/sql-relational-core/collection-methods';
import { postgresTargetDescriptorMetaRuntime } from '../core/descriptor-meta-runtime';
import { postgresFullTextMethods } from '../core/full-text-collection-method';
import { decodePostgresListText } from '../core/list-decoder';
import { postgresQueryOperations } from '../core/query-operations';

export { postgresNowGenerators } from '../core/date-time-now-generators';
export type { PostgresFullTextMethods } from '../core/full-text-collection-method';
export { decodePostgresListText } from '../core/list-decoder';
export { PostgresContractSerializer } from '../core/postgres-contract-serializer';
export { PostgresContractView } from '../core/postgres-contract-view';

export interface PostgresRuntimeTargetInstance extends RuntimeTargetInstance<'sql', 'postgres'> {}

export type PostgresListDecoder = (
  wireValue: unknown,
  decodeElement: (value: unknown) => Promise<unknown>,
) => Promise<readonly unknown[]>;

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
  readonly listDecoder: () => PostgresListDecoder;
  readonly queryOperations: () => SqlOperationDescriptors;
  readonly collectionMethods: () => readonly CollectionMethodContribution[];
} = {
  ...postgresTargetDescriptorMetaRuntime,
  codecs: () => [],
  listDecoder: () => decodePostgresListText,
  queryOperations: () => postgresQueryOperations(),
  collectionMethods: () => [postgresFullTextMethods],
  create(): PostgresRuntimeTargetInstance {
    return {
      familyId: 'sql',
      targetId: 'postgres',
    };
  },
};

export default postgresRuntimeTargetDescriptor;
