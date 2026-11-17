import { postgresCodecRegistry } from '@internal/target-postgres/codecs';
import { moduleBase as targetModuleBase } from '@internal/target-postgres/module-base';
import { postgresAdapterContractContributions } from './contract-contributions';

// ============================================================================ Descriptor metadata ============================================================================

export const postgresAdapterDescriptorMeta = {
  kind: 'adapter',
  familyId: 'sql',
  targetId: 'postgres',
  id: 'postgres',
  version: '0.0.1',
  capabilities: postgresAdapterContractContributions.capabilities,
  types: {
    aggregateDescriptors: postgresAdapterContractContributions.types.aggregateDescriptors,
    codecTypes: {
      codecDescriptors: Array.from(postgresCodecRegistry.values()),
      import: {
        package: `${targetModuleBase}/codec-types`,
        named: 'CodecTypes',
        alias: 'PgTypes',
      },
      typeImports: [
        {
          package: `${targetModuleBase}/codec-types`,
          named: 'JsonValue',
          alias: 'JsonValue',
        },
      ],
      parameterizedOutputTypes: {
        package: `${targetModuleBase}/codec-types`,
        named: 'ParameterizedOutputTypesForTypeParams',
        alias: 'PgParameterizedOutputTypes',
      },
    },
  },
} as const;
