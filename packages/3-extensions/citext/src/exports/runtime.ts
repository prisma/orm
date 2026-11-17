import type { SqlRuntimeExtensionDescriptor } from '@internal/sql-runtime';
import { citextPackMeta } from '../core/descriptor-meta';
import { citextCodecRegistry } from '../core/registry';

const citextRuntimeDescriptor: SqlRuntimeExtensionDescriptor<'postgres'> = {
  kind: 'extension' as const,
  id: citextPackMeta.id,
  version: citextPackMeta.version,
  dataTypes: citextPackMeta.dataTypes,
  familyId: 'sql' as const,
  targetId: 'postgres' as const,
  types: {
    codecTypes: {
      codecDescriptors: Array.from(citextCodecRegistry.values()),
    },
  },
  codecs: () => Array.from(citextCodecRegistry.values()),
  create() {
    return {
      familyId: 'sql' as const,
      targetId: 'postgres' as const,
    };
  },
};

export { citextCodecRegistry };
export default citextRuntimeDescriptor;
