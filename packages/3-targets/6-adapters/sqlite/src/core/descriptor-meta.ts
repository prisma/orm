import { sqliteAggregateDescriptors } from '@internal/target-sqlite/aggregates';
import { sqliteCodecRegistry } from '@internal/target-sqlite/codecs';
import { sqliteDataTypes } from '@internal/target-sqlite/data-types';

// Exclude codecs that carry a renderOutputType: those emit named TypeScript types (e.g.
// Char<N>, Varchar<N>) that are not listed in this adapter's typeImports and would
// produce unresolvable references in contract.d.ts.  All other codecs — including the
// sql/ identity encoders (sql/int@1, sql/float@1) — are kept so execution codec
// lookup works and DDL lowering has access to the full codec set.
const executionCodecDescriptors = Array.from(sqliteCodecRegistry.values()).filter(
  (d) => d.renderOutputType === undefined,
);

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
  dataTypes: sqliteDataTypes,
  types: {
    aggregateDescriptors: sqliteAggregateDescriptors,
    codecTypes: {
      codecDescriptors: executionCodecDescriptors,
      import: {
        package: '@internal/adapter-sqlite/codec-types',
        named: 'CodecTypes',
        alias: 'SqliteTypes',
      },
    },
  },
} as const;
