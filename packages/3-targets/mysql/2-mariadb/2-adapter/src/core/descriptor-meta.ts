import { mysqlAdapterDescriptorMeta } from '@internal/adapter-mysql/adapter';
import { mariadbAdapterCapabilities } from './capabilities';

export const mariadbAdapterDescriptorMeta = {
  ...mysqlAdapterDescriptorMeta,
  targetId: 'mariadb',
  id: 'mariadb',
  capabilities: mariadbAdapterCapabilities,
  types: {
    ...mysqlAdapterDescriptorMeta.types,
    codecTypes: {
      ...mysqlAdapterDescriptorMeta.types.codecTypes,
      import: {
        package: '@internal/adapter-mariadb/codec-types',
        named: 'CodecTypes',
        alias: 'MariadbTypes',
      },
    },
  },
} as const;
