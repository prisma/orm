import type { PrismaNextConfig } from '@internal/config/config-types';
import { ok } from '@internal/utils/result';
import { describe, expect, it } from 'vitest';
import { finalizeConfig } from '../src/finalize-config';

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
    format: 'typescript' as const,
    ...(inputs ? { inputs } : {}),
    load: async () => ok({ targetFamily: 'sql' } as never),
  };
}

describe('finalizeConfig', () => {
  it('leaves the contract absent when the config declares none', () => {
    expect(finalizeConfig(createConfig(), '/project').contract).toBeUndefined();
  });

  describe('the migrations directory', () => {
    it('resolves a relative dir against the config directory, not the invocation directory', () => {
      const config = createConfig(undefined, { migrations: { dir: 'db' } });

      expect(finalizeConfig(config, '/project').migrations?.dir).toBe('/project/db');
    });

    it('supplies the default dir so callers never re-derive it against another base', () => {
      expect(finalizeConfig(createConfig(), '/project').migrations?.dir).toBe(
        '/project/migrations',
      );
    });

    it('leaves an absolute dir alone', () => {
      const config = createConfig(undefined, { migrations: { dir: '/elsewhere/db' } });

      expect(finalizeConfig(config, '/project').migrations?.dir).toBe('/elsewhere/db');
    });
  });

  it('resolves relative inputs and output against the config directory', () => {
    const config = createConfig({
      source: createSource(['./schema.prisma', 'nested/extra.prisma']),
      output: './generated/contract.json',
    });

    const result = finalizeConfig(config, '/project');

    expect(result.contract?.source.inputs).toEqual([
      '/project/schema.prisma',
      '/project/nested/extra.prisma',
    ]);
    expect(result.contract?.output).toBe('/project/generated/contract.json');
  });

  it('preserves the source when inputs are omitted', () => {
    const config = createConfig({
      source: createSource(),
      output: './contract.json',
    });

    const result = finalizeConfig(config, '/project');

    expect(result.contract?.source.inputs).toBeUndefined();
  });

  it('leaves emitted artifact collision checks to tooling config loaders', () => {
    const config = createConfig({
      source: createSource(['./generated/contract.json']),
      output: './generated/contract.json',
    });

    const result = finalizeConfig(config, '/project');

    expect(result.contract?.source.inputs).toEqual(['/project/generated/contract.json']);
    expect(result.contract?.output).toBe('/project/generated/contract.json');
  });

  it('preserves non-contract authoring fields while resolving the contract', () => {
    const driver = { id: 'postgres', familyId: 'sql', create: () => ({}) };
    const config = createConfig(
      {
        source: createSource(['./schema.prisma']),
        output: './generated/contract.json',
      },
      { driver } as unknown as Partial<PrismaNextConfig>,
    );

    const result = finalizeConfig(config, '/project');

    expect(result.family).toBe(config.family);
    expect(result.target).toBe(config.target);
    expect(result.adapter).toBe(config.adapter);
    expect(result.driver).toBe(driver);
  });
});
