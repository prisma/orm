import { sqliteCodecRegistry } from '@internal/target-sqlite/codecs';
import { sqliteAdapterContractContributions } from './contract-contributions';
import { moduleBase } from './module-base';

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
        package: `${moduleBase}/codec-types`,
        named: 'CodecTypes',
        alias: 'SqliteTypes',
      },
    },
  },
} as const;
