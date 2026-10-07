import { sqliteAggregateDescriptors } from '@internal/target-sqlite/aggregates';
import { sqliteCodecRegistry } from '@internal/target-sqlite/codecs';

export const sqliteAdapterDescriptorMeta = {
  kind: 'adapter',
  familyId: 'sql',
  targetId: 'sqlite',
  id: 'sqlite',
  version: '0.0.1',
  capabilities: {
    sql: {
      orderBy: true,
      limit: true,
      lateral: false,
      jsonAgg: true,
      returning: true,
      foreignKeys: true,
      enums: false,
      insertOnConflictSkip: true,
      insertOnConflictWithoutTarget: true,
    },
  },
  types: {
    aggregateDescriptors: sqliteAggregateDescriptors,
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
