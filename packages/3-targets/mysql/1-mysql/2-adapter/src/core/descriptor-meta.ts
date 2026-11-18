import { mysqlCodecRegistry } from '@internal/target-mysql/codecs';
import { mysqlAdapterContractContributions } from './contract-contributions';
import { moduleBase } from './module-base';

export const mysqlAdapterDescriptorMeta = {
  kind: 'adapter',
  familyId: 'sql',
  targetId: 'mysql',
  id: 'mysql',
  version: '0.0.1',
  capabilities: mysqlAdapterContractContributions.capabilities,
  types: {
    aggregateDescriptors: mysqlAdapterContractContributions.types.aggregateDescriptors,
    codecTypes: {
      codecDescriptors: Array.from(mysqlCodecRegistry.values()),
      import: {
        package: `${moduleBase}/codec-types`,
        named: 'CodecTypes',
        alias: 'MysqlTypes',
      },
    },
  },
} as const;
