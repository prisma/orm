import { postgresAggregateDescriptors } from '@internal/target-postgres/aggregates';
import { postgresCodecRegistry } from '@internal/target-postgres/codecs';

// ============================================================================ Helper functions for reducing boilerplate ============================================================================

/** Creates a type import spec for codec types */
const codecTypeImport = (named: string) =>
  ({
    package: '@internal/target-postgres/codec-types',
    named,
    alias: named,
  }) as const;

// ============================================================================ Descriptor metadata ============================================================================

export const postgresAdapterDescriptorMeta = {
  kind: 'adapter',
  familyId: 'sql',
  targetId: 'postgres',
  id: 'postgres',
  version: '0.0.1',
  capabilities: {
    postgres: {
      orderBy: true,
      limit: true,
      lateral: true,
      jsonAgg: true,
      returning: true,
      distinctOn: true,
    },
    sql: {
      enums: true,
      returning: true,
      defaultInInsert: true,
      lateral: true,
      scalarList: true,
      checkConstraint: true,
      insertOnConflictSkip: true,
      insertOnConflictWithoutTarget: true,
    },
  },
  types: {
    aggregateDescriptors: postgresAggregateDescriptors,
    codecTypes: {
      codecDescriptors: Array.from(postgresCodecRegistry.values()),
      import: {
        package: '@internal/target-postgres/codec-types',
        named: 'CodecTypes',
        alias: 'PgTypes',
      },
      typeImports: [
        {
          package: '@internal/target-postgres/codec-types',
          named: 'JsonValue',
          alias: 'JsonValue',
        },
        codecTypeImport('Char'),
        codecTypeImport('Varchar'),
        codecTypeImport('Numeric'),
        codecTypeImport('Bit'),
        codecTypeImport('VarBit'),
        codecTypeImport('Timestamp'),
        codecTypeImport('Timestamptz'),
        codecTypeImport('Time'),
        codecTypeImport('Timetz'),
        codecTypeImport('Interval'),
        codecTypeImport('TimestampString'),
        codecTypeImport('TimestamptzString'),
        codecTypeImport('TimeString'),
      ],
    },
  },
} as const;
