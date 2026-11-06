import type { PrismaNextConfig } from '@internal/config/config-types';
import { defineConfig } from '@internal/config/config-types';
import type { Contract } from '@internal/contract/types';
import { ok } from '@internal/utils/result';
import { describe, expect, it } from 'vitest';

describe('defineConfig', () => {
  const createSourceProvider = (inputs: readonly string[] | undefined = undefined) => ({
    format: 'typescript' as const,
    ...(!inputs ? {} : { inputs }),
    load: async () => ok({ targetFamily: 'sql' } as Contract),
  });

  const mockHook = {
    id: 'sql',
    generateStorageType: () => '{}',
    generateModelStorageType: () => '{}',
    getFamilyImports: () => [] as string[],
    getFamilyTypeAliases: () => '',
    getTypeMapsExpression: () => 'never',
    getContractWrapper: (base: string, tm: string) =>
      `export type Contract = ${base} & { typeMaps: ${tm} };`,
  };

  const baseConfig: PrismaNextConfig = {
    family: {
      kind: 'family',
      id: 'sql',
      familyId: 'sql',
      version: '0.0.1',
      emission: mockHook,
      create: () => ({
        familyId: 'sql',
        markerLocation: 'prisma_contract.marker',
        deserializeContract: (contract: unknown) => contract as Contract,
        storageNameOf: (operation) => operation.id,
        verify: async () => ({
          ok: true,
          summary: 'test',
          contract: { storageHash: 'test' },
          target: { expected: 'postgres' },
          timings: { total: 0 },
        }),
        verifySchema: () => ({
          ok: true,
          summary: 'test',
          contract: { storageHash: 'test' },
          target: { expected: 'postgres' },
          schema: {
            issues: [],
          },
          timings: { total: 0 },
        }),
        signSpaces: async () => [],
        readMarker: async () => null,
        readAllMarkers: async () => new Map(),
        readLedger: async () => [],
        introspect: async () => ({ tables: {}, extensions: [] }),
      }),
    },
    target: {
      kind: 'target',
      familyId: 'sql',
      targetId: 'postgres',
      defaultNamespaceId: 'public',
      id: 'postgres',
      version: '0.0.1',
      contractSerializer: {
        deserializeContract: (json) => json as never,
        serializeContract: (contract) => contract as never,
      },
      create: () => ({ familyId: 'sql', targetId: 'postgres' }),
    },
    adapter: {
      kind: 'adapter',
      familyId: 'sql',
      targetId: 'postgres',
      id: 'postgres',
      version: '0.0.1',
      create: () => ({ familyId: 'sql', targetId: 'postgres' }),
    },
    driver: {
      kind: 'driver',
      familyId: 'sql',
      targetId: 'postgres',
      id: 'postgres',
      version: '0.0.1',
      create: async () => ({
        familyId: 'sql',
        targetId: 'postgres',
        query: async () => ({ rows: [] }),
        close: async () => {},
      }),
    },
    extensions: [],
  };

  it('preserves omitted contract inputs', () => {
    const config: PrismaNextConfig = {
      ...baseConfig,
      contract: {
        source: createSourceProvider(),
      },
    };

    const result = defineConfig(config);
    expect(result.contract?.source.inputs).toBeUndefined();
  });

  it('validates contract source accepts provider objects', () => {
    const sourceProvider = createSourceProvider();
    const config: PrismaNextConfig = {
      ...baseConfig,
      contract: {
        source: sourceProvider,
      },
    };

    const result = defineConfig(config);
    expect(result.contract?.source).toBe(sourceProvider);
  });
});
