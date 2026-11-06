import { mysqlCodecRegistry } from '@internal/target-mysql/codecs';
import { mariadbAdapterCapabilities } from './capabilities';

export const mariadbAdapterDescriptorMeta = {
  kind: 'adapter',
  familyId: 'sql',
  targetId: 'mariadb',
  id: 'mariadb',
  version: '0.0.1',
  capabilities: mariadbAdapterCapabilities,
  types: {
    codecTypes: {
      codecDescriptors: Array.from(mysqlCodecRegistry.values()),
      import: {
        package: '@internal/adapter-mariadb/codec-types',
        named: 'CodecTypes',
        alias: 'MariadbTypes',
      },
    },
  },
} as const;
