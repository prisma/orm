import type { PrismaNextConfig } from '@internal/config/config-types';
import { defineConfig } from '@internal/config/config-types';
import type { Contract } from '@internal/contract/types';
import { typescriptContract } from '@internal/sql-contract-ts/config-types';
import { ok } from '@internal/utils/result';
import { describe, expect, it } from 'vitest';

describe('defineConfig', () => {
  const createSourceProvider = (inputs: readonly string[] | undefined = undefined) => ({
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
        deserializeContract: (contract: unknown) => contract as Contract,
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
        sign: async () => ({
          ok: true,
          summary: 'test',
          contract: { storageHash: 'test' },
          target: { expected: 'postgres' },
          marker: { created: true, updated: false },
          timings: { total: 0 },
        }),
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

  it('returns the config object unchanged when no contract', () => {
    const result = defineConfig(baseConfig);
    expect(result).toBe(baseConfig);
    expect(result.family.familyId).toBe('sql');
    expect(result.target.id).toBe('postgres');
    expect(result.adapter.id).toBe('postgres');
  });

  it('normalizes contract config with default output', () => {
    const config: PrismaNextConfig = {
      ...baseConfig,
      contract: {
        source: createSourceProvider(),
      },
    };

    const result = defineConfig(config);
    expect(result.contract?.output).toBe('src/prisma/contract.json');
  });

  it('normalizes contract config with custom output', () => {
    const config: PrismaNextConfig = {
      ...baseConfig,
      contract: {
        source: createSourceProvider(['./schema.prisma']),
        output: 'custom/contract.json',
      },
    };

    const result = defineConfig(config);
    expect(result.contract?.output).toBe('custom/contract.json');
    expect(result.contract?.source.inputs).toEqual(['./schema.prisma']);
  });

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

  it('does not validate structure — the config loader reports section diagnostics instead', () => {
    const invalidConfig = {
      family: null,
    } as unknown as PrismaNextConfig;

    expect(() => defineConfig(invalidConfig)).not.toThrow();
  });

  it('builds TypeScript contract config via helper utility', async () => {
    const contract = { targetFamily: 'sql' } as Contract;
    const config = typescriptContract(contract, 'output/contract.json');
    const result = await config.source.load({
      composedExtensions: [],
      composedExtensionContracts: new Map(),
      authoringContributions: {
        field: {},
        type: {},
        entityTypes: {},
        pslBlockDescriptors: {},
        modelAttributes: {},
        attributeSpecs: { model: {}, field: {} },
      },
      codecLookup: {
        get: () => undefined,
        targetTypesFor: () => undefined,
        renderOutputTypeFor: () => undefined,
      },
      controlMutationDefaults: { defaultFunctionRegistry: new Map(), generatorDescriptors: [] },
      resolvedInputs: [],
      capabilities: {},
    });

    expect(config.output).toBe('output/contract.json');
    expect(config.source.inputs).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(result.assertOk()).toBe(contract);
  });
});
