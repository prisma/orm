import { mysqlAdapterDescriptorMeta } from '@internal/adapter-mysql/adapter';
import { mariadbTargetDescriptorMetaRuntime } from '@internal/target-mariadb/descriptor-meta-runtime';
import { mariadbAdapterCapabilities } from './capabilities';

export const mariadbAdapterDescriptorMeta = {
  ...mysqlAdapterDescriptorMeta,
  targetId: mariadbTargetDescriptorMetaRuntime.targetId,
  id: mariadbTargetDescriptorMetaRuntime.id,
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
