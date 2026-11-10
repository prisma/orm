import { sqliteCodecRegistry } from '@internal/target-sqlite/codecs';
import { sqliteAdapterContractContributions } from './contract-contributions';

export const sqliteAdapterDescriptorMeta = {
  kind: 'adapter',
  familyId: 'sql',
  targetId: 'sqlite',
  id: 'sqlite',
  version: '0.0.1',
  capabilities: sqliteAdapterContractContributions.capabilities,
  types: {
    aggregateDescriptors: sqliteAdapterContractContributions.types.aggregateDescriptors,
    codecTypes: {
      codecDescriptors: Array.from(sqliteCodecRegistry.values()),
      import: {
        package: '@internal/adapter-sqlite/codec-types',
        named: 'CodecTypes',
        alias: 'SqliteTypes',
      },
    },
  },
} as const;
