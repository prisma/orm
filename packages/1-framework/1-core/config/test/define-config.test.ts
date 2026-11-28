import type { Contract } from '@internal/contract/types';
import type {
  ControlDriverInstance,
  ControlFamilyInstance,
} from '@internal/framework-components/control';
import { ok } from '@internal/utils/result';
import { describe, expect, it } from 'vitest';
import { defineConfig, type PrismaConfig } from '../src/config-types';

const mockHook = {
  id: 'sql',
  generateStorageType: () => '{}',
  generateModelStorageType: () => '{}',
  getFamilyImports: () => [],
  getFamilyTypeAliases: () => '',
  getTypeMapsExpression: () => 'never',
  getContractWrapper: (base: string, tm: string) =>
    `export type Contract = ${base} & { typeMaps: ${tm} };`,
};

function createSourceProvider(overrides: Record<string, unknown> = {}) {
  return {
    format: 'typescript',
    load: async () => ok({ targetFamily: 'sql' } as Contract),
    ...overrides,
  };
}

function createValidConfig(overrides: Record<string, unknown> = {}): PrismaConfig {
  return {
    family: {
      kind: 'family',
      id: 'sql',
      familyId: 'sql',
      version: '0.0.1',
      manifest: {},
      emission: mockHook,
      create: () => ({ familyId: 'sql' }) as unknown as ControlFamilyInstance<'sql', unknown>,
    },
    target: {
      kind: 'target',
      familyId: 'sql',
      targetId: 'postgres',
      defaultNamespaceId: 'public',
      id: 'postgres',
      version: '0.0.1',
      manifest: {},
      contractSerializer: {
        deserializeContract: (json) => json as never,
        serializeContract: (contract) => contract as never,
        normalizeStorage: (storage) => storage,
      },
      create: () => ({ familyId: 'sql', targetId: 'postgres' }),
    },
    adapter: {
      kind: 'adapter',
      familyId: 'sql',
      targetId: 'postgres',
      id: 'postgres',
      version: '0.0.1',
      manifest: {},
      create: () => ({ familyId: 'sql', targetId: 'postgres' }),
    },
    driver: {
      kind: 'driver',
      familyId: 'sql',
      targetId: 'postgres',
      id: 'postgres',
      version: '0.0.1',
      manifest: {},
      create: async () =>
        ({
          familyId: 'sql',
          targetId: 'postgres',
          query: async () => ({ rows: [] }),
          close: async () => {},
        }) as ControlDriverInstance<'sql', 'postgres'>,
    },
    extensions: [],
    ...overrides,
  } as PrismaConfig;
}

describe('defineConfig', () => {
  it('returns the same object when contract is absent', () => {
    const config = createValidConfig();
    expect(defineConfig(config)).toBe(config);
  });

  it('applies default output path when contract output is missing', () => {
    const config = createValidConfig({
      contract: { source: createSourceProvider() },
    });

    const result = defineConfig(config);
    expect(result.contract?.output).toBe('src/prisma/contract.json');
  });

  it('preserves source provider metadata', () => {
    const config = createValidConfig({
      contract: { source: createSourceProvider({ inputs: ['./schema.prisma'] }) },
    });

    const result = defineConfig(config);
    expect(result.contract?.source.inputs).toEqual(['./schema.prisma']);
  });

  it('preserves custom output path', () => {
    const config = createValidConfig({
      contract: { source: createSourceProvider(), output: 'custom/contract.json' },
    });

    const result = defineConfig(config);
    expect(result.contract?.output).toBe('custom/contract.json');
  });

  it('preserves the module generated contract types import from', () => {
    const config = createValidConfig({
      contract: { source: createSourceProvider(), typesModule: '@acme/orm-db/contract-types' },
    });

    expect(defineConfig(config).contract).toEqual({
      source: config.contract?.source,
      output: 'src/prisma/contract.json',
      typesModule: '@acme/orm-db/contract-types',
    });
  });

  it('preserves the module rendered migration files import from', () => {
    const config = createValidConfig({
      contract: { source: createSourceProvider() },
      migrations: { dir: 'db', module: '@acme/orm-db/migration' },
    });

    expect(defineConfig(config).migrations).toEqual({
      dir: 'db',
      module: '@acme/orm-db/migration',
    });
  });

  it('does not validate structure — invalid shapes pass through for the loader to diagnose', () => {
    const invalidConfig = { family: null } as unknown as PrismaConfig;
    expect(() => defineConfig(invalidConfig)).not.toThrow();
  });
});
