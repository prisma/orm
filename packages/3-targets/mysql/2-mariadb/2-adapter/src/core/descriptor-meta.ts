import { mysqlAdapterDescriptorMeta } from '@internal/adapter-mysql/adapter';
import { mariadbTargetDescriptorMetaRuntime } from '@internal/target-mariadb/descriptor-meta-runtime';
import { mariadbAdapterContractContributions } from './contract-contributions';
import { moduleBase } from './module-base';

export const mariadbAdapterDescriptorMeta = {
  ...mysqlAdapterDescriptorMeta,
  targetId: mariadbTargetDescriptorMetaRuntime.targetId,
  id: mariadbTargetDescriptorMetaRuntime.id,
  capabilities: mariadbAdapterContractContributions.capabilities,
  types: {
    ...mysqlAdapterDescriptorMeta.types,
    aggregateDescriptors: mariadbAdapterContractContributions.types.aggregateDescriptors,
    codecTypes: {
      ...mysqlAdapterDescriptorMeta.types.codecTypes,
      import: {
        package: `${moduleBase}/codec-types`,
        named: 'CodecTypes',
        alias: 'MariadbTypes',
      },
    },
  },
} as const;
