import type { Contract } from '@internal/contract/types';
import type {
  ControlDriverInstance,
  ControlFamilyInstance,
} from '@internal/framework-components/control';
import { ok } from '@internal/utils/result';
import { describe, expect, it } from 'vitest';
import { CONFIG_RESOLVE, isUnresolvedConfig } from '../src/config-resolve';
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
  it('returns the config unchanged apart from the resolver when contract is absent', () => {
    const config = createValidConfig();

    const result = defineConfig(config);

    expect(result).toMatchObject(config);
    expect(result.contract).toBeUndefined();
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
  it('attaches a resolver and leaves relative paths as written', () => {
    const config = defineConfig(
      createValidConfig({
        contract: {
          source: createSourceProvider({ inputs: ['./schema.prisma'] }),
          output: './out/contract.json',
        },
        migrations: { dir: './db' },
      }),
    );

    expect(isUnresolvedConfig(config)).toBe(true);
    expect(config.contract?.source.inputs).toEqual(['./schema.prisma']);
    expect(config.migrations?.dir).toBe('./db');
  });

  it('resolves every path against the directory the resolver is given', () => {
    const config = defineConfig(
      createValidConfig({
        contract: {
          source: createSourceProvider({ inputs: ['./schema.prisma'] }),
          output: './out/contract.json',
        },
        migrations: { dir: './db' },
      }),
    );
    if (!isUnresolvedConfig(config)) throw new Error('expected a resolver');

    expect(config[CONFIG_RESOLVE]('/app')).toMatchObject({
      rootDir: '/app',
      contract: { source: { inputs: ['/app/schema.prisma'] }, output: '/app/out/contract.json' },
      migrations: { dir: '/app/db' },
    });
  });
});
