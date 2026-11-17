import { mysqlCodecRegistry } from '@internal/target-mysql/codecs';
import { mysqlAdapterContractContributions } from './contract-contributions';

export const mysqlAdapterDescriptorMeta = {
  kind: 'adapter',
  familyId: 'sql',
  targetId: 'mysql',
  id: 'mysql',
  version: '0.0.1',
  capabilities: mysqlAdapterContractContributions.capabilities,
  types: {
    codecTypes: {
      codecDescriptors: Array.from(mysqlCodecRegistry.values()),
      import: {
        package: '@internal/adapter-mysql/codec-types',
        named: 'CodecTypes',
        alias: 'MysqlTypes',
      },
    },
  },
} as const;
