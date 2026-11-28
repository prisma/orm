import type { ContractSourceProvider } from '@internal/config/config-types';
import type { Contract } from '@internal/contract/types';
import type {
  ControlAdapterDescriptor,
  ControlDriverDescriptor,
  ControlDriverInstance,
  ControlFamilyDescriptor,
  ControlFamilyInstance,
  ControlTargetDescriptor,
  SpaceToSign,
  VerifyDatabaseResult,
  VerifyDatabaseSchemaResult,
} from '@internal/framework-components/control';
import type { EmissionSpi } from '@internal/framework-components/emission';
import { ifDefined } from '@internal/utils/defined';
import { ok } from '@internal/utils/result';

/**
 * The smallest contract the real emitter accepts: a storage envelope with a
 * hash and no models. No module mocks — the emit tests run the real
 * `@internal/emitter` over this, so they hold regardless of which test file
 * warmed the module registry first (`isolate: false` shares it).
 */
export function emittableContract(): Contract {
  return {
    formatVersion: 1,
    target: 'postgres',
    targetFamily: 'sql',
    roots: {},
    domain: { namespaces: { app: { models: {} } } },
    storage: { storageHash: 'test-storage-hash', namespaces: { app: { tables: {} } } },
    extensions: {},
    capabilities: {},
    meta: {},
    profileHash: 'test-profile-hash',
    models: {},
  } as unknown as Contract;
}

export function createSourceProvider(
  load: ContractSourceProvider['load'] = async () => ok(emittableContract()),
  inputs?: readonly string[],
): ContractSourceProvider {
  return {
    format: 'typescript',
    ...ifDefined('inputs', inputs),
    load,
  };
}

export function createMockComponents() {
  const mockDriver = {
    close: async () => {},
  } as unknown as ControlDriverInstance<string, string>;

  const mockFamilyInstance = {
    introspect: async () => ({ tables: [] }),
    deserializeContract: (ir: unknown) => ir as Contract,
    readMarker: async () => null,
    readAllMarkers: async () => new Map(),
    readLedger: async () => [],
    verify: async (): Promise<VerifyDatabaseResult> => ({
      ok: true,
      summary: 'Verification passed',
      contract: { storageHash: 'test-hash' },
      marker: { storageHash: 'test-hash' },
      target: { expected: 'postgres' },
      timings: { total: 10 },
    }),
    verifySchema: (): VerifyDatabaseSchemaResult => ({
      ok: true,
      summary: 'Schema verification passed',
      contract: { storageHash: 'test-hash' },
      target: { expected: 'postgres' },
      schema: {
        issues: [],
      },
      timings: { total: 10 },
    }),
    signSpaces: async ({ spaces }: { readonly spaces: readonly SpaceToSign[] }) =>
      spaces.map(({ space, contract }) => ({
        status: 'created',
        space,
        contract: { storageHash: contract.storage.storageHash, profileHash: contract.profileHash },
      })),
  } as unknown as ControlFamilyInstance<string, unknown>;

  const mockHook: EmissionSpi = {
    id: 'sql',
    generateStorageType: () =>
      '{ readonly tables: Record<string, never>; readonly types: Record<string, never>; readonly storageHash: StorageHash }',
    generateModelStorageType: () => 'Record<string, never>',
    getFamilyImports: (typesModule) => [
      { moduleSpecifier: typesModule, symbol: 'ContractWithTypeMaps', typeOnly: true },
      { moduleSpecifier: typesModule, symbol: 'TypeMaps', alias: 'TypeMapsType', typeOnly: true },
    ],
    getFamilyTypeAliases: () => '',
    getTypeMapsExpression: () => 'TypeMapsType<CodecTypes, OperationTypes>',
    getContractWrapper: (base: string, tm: string) =>
      `export type Contract = ContractWithTypeMaps<${base}, ${tm}>;`,
  };

  const mockFamily = {
    familyId: 'sql',
    emission: mockHook,
    create: () => mockFamilyInstance,
    // biome-ignore lint/suspicious/noExplicitAny: required for mock flexibility
  } as unknown as ControlFamilyDescriptor<any, any>;

  const mockTarget = {
    kind: 'target',
    targetId: 'postgres',
    familyId: 'sql',
    contractSerializer: {
      serializeContract: (contract: unknown) => contract,
      deserializeContract: (json: unknown) => json,
    },
    // biome-ignore lint/suspicious/noExplicitAny: required for mock flexibility
  } as unknown as ControlTargetDescriptor<any, any, any>;

  const mockAdapter = {
    kind: 'adapter',
    familyId: 'sql',
    targetId: 'postgres',
    create: () => ({ familyId: 'sql', targetId: 'postgres' }),
    // biome-ignore lint/suspicious/noExplicitAny: required for mock flexibility
  } as unknown as ControlAdapterDescriptor<any, any, any>;

  const mockDriverDescriptor = {
    targetId: 'postgres',
    create: async () => mockDriver,
    // biome-ignore lint/suspicious/noExplicitAny: required for mock flexibility
  } as unknown as ControlDriverDescriptor<any, any, any, any>;

  return {
    mockDriver,
    mockFamilyInstance,
    mockFamily,
    mockTarget,
    mockAdapter,
    mockDriverDescriptor,
  };
}
