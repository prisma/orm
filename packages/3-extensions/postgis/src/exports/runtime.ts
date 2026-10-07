import type { SqlRuntimeExtensionDescriptor } from '@internal/sql-runtime';
import { postgisPackMeta, postgisQueryOperations } from '../core/descriptor-meta';
import { postgisCodecRegistry } from '../core/registry';

const postgisRuntimeDescriptor: SqlRuntimeExtensionDescriptor<'postgres'> = {
  kind: 'extension' as const,
  id: postgisPackMeta.id,
  version: postgisPackMeta.version,
  dataTypes: postgisPackMeta.dataTypes,
  familyId: 'sql' as const,
  targetId: 'postgres' as const,
  // Without it, the Postgres
  // adapter's runtime codec lookup would miss `pg/geometry@1` and
  // `$N::geometry` casts would disappear once the renderer switches
  // to lookup-driven cast policy.
  types: {
    codecTypes: {
      codecDescriptors: Array.from(postgisCodecRegistry.values()),
    },
  },
  codecs: () => Array.from(postgisCodecRegistry.values()),
  queryOperations: () => postgisQueryOperations(),
  create() {
    return {
      familyId: 'sql' as const,
      targetId: 'postgres' as const,
    };
  },
};

export { postgisCodecRegistry };
export default postgisRuntimeDescriptor;
