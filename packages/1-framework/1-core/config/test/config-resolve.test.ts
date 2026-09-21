import { ok } from '@internal/utils/result';
import { describe, expect, it } from 'vitest';
import { resolveConfigPaths, withConfigDefaults } from '../src/config-resolve';
import type { PrismaNextConfig } from '../src/config-types';

function createConfig(
  contract?: PrismaNextConfig['contract'],
  overrides: Partial<PrismaNextConfig> = {},
): PrismaNextConfig {
  return {
    family: {
      kind: 'family',
      id: 'sql',
      familyId: 'sql',
      version: '0.0.1',
      manifest: {},
      emission: { id: 'sql' } as never,
      create: () => ({ familyId: 'sql' }) as never,
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
        serializeContract: () => ({}),
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
    ...(contract ? { contract } : {}),
    ...overrides,
  } as PrismaNextConfig;
}

function createSource(inputs?: readonly string[]) {
  return {
    ...(inputs ? { inputs } : {}),
    load: async () => ok({ targetFamily: 'sql' } as never),
  };
}

describe('resolveConfigPaths', () => {
  it('records the base directory on the section', () => {
    expect(resolveConfigPaths(createConfig(), '/project').baseDir).toBe('/project');
  });

  it('leaves the contract absent when the config declares none', () => {
    expect(resolveConfigPaths(createConfig(), '/project').contract).toBeUndefined();
  });

  describe('the migrations directory', () => {
    it('resolves a relative dir against the root, not the invocation directory', () => {
      const config = createConfig(undefined, { migrations: { dir: 'db' } });

      expect(resolveConfigPaths(config, '/project').migrations?.dir).toBe('/project/db');
    });

    it('leaves an unauthored dir absent, so a layer default never shadows another layer', () => {
      expect(resolveConfigPaths(createConfig(), '/project').migrations).toBeUndefined();
    });

    it('leaves a value that is not a string for validation to report', () => {
      const config = createConfig(undefined, { migrations: { dir: 7 as unknown as string } });

      expect(resolveConfigPaths(config, '/project').migrations?.dir).toBe(7);
    });

    it('leaves an absolute dir alone', () => {
      const config = createConfig(undefined, { migrations: { dir: '/elsewhere/db' } });

      expect(resolveConfigPaths(config, '/project').migrations?.dir).toBe('/elsewhere/db');
    });
  });

  it('resolves relative inputs and output against the root', () => {
    const config = createConfig({
      source: createSource(['./schema.prisma', 'nested/extra.prisma']),
      output: './generated/contract.json',
    });

    const result = resolveConfigPaths(config, '/project');

    expect(result.contract?.source.inputs).toEqual([
      '/project/schema.prisma',
      '/project/nested/extra.prisma',
    ]);
    expect(result.contract?.output).toBe('/project/generated/contract.json');
  });

  it('leaves inputs that are not a list for validation to report', () => {
    const config = createConfig({
      source: {
        inputs: 'schema.prisma' as unknown as readonly string[],
        load: createSource().load,
      },
      output: './contract.json',
    });

    expect(resolveConfigPaths(config, '/project').contract?.source.inputs).toBe('schema.prisma');
  });

  it('preserves the source when inputs are omitted', () => {
    const config = createConfig({ source: createSource(), output: './contract.json' });

    expect(resolveConfigPaths(config, '/project').contract?.source.inputs).toBeUndefined();
  });

  it('preserves non-contract authoring fields while resolving the contract', () => {
    const driver = { id: 'postgres', familyId: 'sql', create: () => ({}) };
    const config = createConfig(
      { source: createSource(['./schema.prisma']), output: './generated/contract.json' },
      { driver } as unknown as Partial<PrismaNextConfig>,
    );

    const result = resolveConfigPaths(config, '/project');

    expect(result.family).toBe(config.family);
    expect(result.target).toBe(config.target);
    expect(result.driver).toBe(driver);
  });

  it('is idempotent: resolving a resolved section changes nothing', () => {
    const config = createConfig(
      { source: createSource(['./schema.prisma']), output: './contract.json' },
      { migrations: { dir: 'db' } },
    );
    const once = resolveConfigPaths(config, '/project');

    expect(resolveConfigPaths(once, '/somewhere/else')).toEqual({
      ...once,
      baseDir: '/somewhere/else',
    });
  });
});

describe('withConfigDefaults', () => {
  it('supplies the migrations dir under the root so no caller re-derives it', () => {
    const config = resolveConfigPaths(createConfig(), '/project');

    expect(withConfigDefaults({ ...config, baseDir: '/project' }).migrations.dir).toBe(
      '/project/migrations',
    );
  });

  it('keeps an authored migrations dir', () => {
    const config = resolveConfigPaths(createConfig(undefined, { migrations: { dir: 'db' } }), '/p');

    expect(withConfigDefaults({ ...config, baseDir: '/p' }).migrations.dir).toBe('/p/db');
  });
});
