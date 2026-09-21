import type { Contract } from '@internal/contract/types';
import type {
  ControlDriverInstance,
  ControlFamilyInstance,
} from '@internal/framework-components/control';
import { ok } from '@internal/utils/result';
import { describe, expect, it } from 'vitest';
import { withBaseDir } from '../src/config-base-dir';
import { defineConfig, type PrismaNextConfig } from '../src/config-types';

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

function createSourceProvider(overrides: Record<string, unknown> = {}) {
  return {
    load: async () => ok({ targetFamily: 'sql' } as Contract),
    ...overrides,
  };
}

function createValidConfig(overrides: Record<string, unknown> = {}): PrismaNextConfig {
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
      id: 'postgres',
      version: '0.0.1',
      manifest: {},
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
  } as PrismaNextConfig;
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

  it('does not validate structure — invalid shapes pass through for the loader to diagnose', () => {
    const invalidConfig = { family: null } as unknown as PrismaNextConfig;
    expect(() => defineConfig(invalidConfig)).not.toThrow();
  });
});

describe('defineConfig path resolution', () => {
  const authored = () =>
    createValidConfig({
      contract: {
        source: createSourceProvider({ inputs: ['./schema.prisma'] }),
        output: './out/contract.json',
      },
      migrations: { dir: './db' },
    });

  it('resolves every relative path against the base directory the loader published', async () => {
    const config = await withBaseDir('/app', async () => defineConfig(authored()));

    expect(config).toMatchObject({
      baseDir: '/app',
      contract: { source: { inputs: ['/app/schema.prisma'] }, output: '/app/out/contract.json' },
      migrations: { dir: '/app/db' },
    });
  });

  it('evaluated outside a loader, leaves the paths as written and records no baseDir', () => {
    const config = defineConfig(authored());

    expect(config.baseDir).toBeUndefined();
    expect(config.contract?.source.inputs).toEqual(['./schema.prisma']);
    expect(config.migrations?.dir).toBe('./db');
  });
});
