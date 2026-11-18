import type { EmissionSpi } from '@internal/framework-components/emission';

export function createMockSpi(overrides: Partial<EmissionSpi> = {}): EmissionSpi {
  return {
    id: 'sql',
    generateStorageType: () =>
      '{ readonly tables: Record<string, never>; readonly types: Record<string, never>; readonly storageHash: StorageHash }',
    generateModelStorageType: () => 'Record<string, never>',
    getFamilyImports: (typesModule) => [
      { moduleSpecifier: typesModule, symbol: 'ContractWithTypeMaps', typeOnly: true },
      { moduleSpecifier: typesModule, symbol: 'TypeMaps', alias: 'TypeMapsType', typeOnly: true },
    ],
    getFamilyTypeAliases: () => 'export type LaneCodecTypes = CodecTypes;',
    getTypeMapsExpression: () => 'TypeMapsType<CodecTypes>',
    getContractWrapper: (base, tm) =>
      `export type Contract = ContractWithTypeMaps<${base}, ${tm}>;`,
    ...overrides,
  };
}
