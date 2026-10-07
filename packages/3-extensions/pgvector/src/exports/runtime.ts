import type { SqlRuntimeExtensionDescriptor } from '@internal/sql-runtime';
import { pgvectorPackMeta, pgvectorQueryOperations } from '../core/descriptor-meta';
import { pgvectorCodecRegistry } from '../core/registry';

const pgvectorRuntimeDescriptor: SqlRuntimeExtensionDescriptor<'postgres'> = {
  kind: 'extension' as const,
  id: pgvectorPackMeta.id,
  version: pgvectorPackMeta.version,
  dataTypes: pgvectorPackMeta.dataTypes,
  familyId: 'sql' as const,
  targetId: 'postgres' as const,
  types: {
    codecTypes: {
      codecDescriptors: Array.from(pgvectorCodecRegistry.values()),
    },
  },
  codecs: () => Array.from(pgvectorCodecRegistry.values()),
  queryOperations: () => pgvectorQueryOperations(),
  create() {
    return {
      familyId: 'sql' as const,
      targetId: 'postgres' as const,
    };
  },
};

export { pgvectorCodecRegistry };
export default pgvectorRuntimeDescriptor;
