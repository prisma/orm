import mongoAdapter from '@internal/adapter-mongo/control';
import { defineConfig as coreDefineConfig } from '@internal/config/config-types';
import mongoDriver from '@internal/driver-mongo/control';
import { mongoFamilyDescriptor } from '@internal/family-mongo/control';
import { mongoContract } from '@internal/mongo-contract-psl/provider';
import { mongoTargetDescriptor } from '@internal/target-mongo/control';
import { describe, expect, it } from 'vitest';
import { defineConfig } from '../../src/config/define-config';

describe('defineConfig facade', () => {
  it('produces config equivalent to manual wiring for .prisma contracts', () => {
    const contractPath = './prisma/contract.prisma';

    const facadeConfig = defineConfig({ contract: contractPath });

    const manualConfig = coreDefineConfig({
      family: mongoFamilyDescriptor,
      target: mongoTargetDescriptor,
      adapter: mongoAdapter,
      driver: mongoDriver,
      contract: mongoContract(contractPath, {
        output: './prisma/contract.json',
      }),
    });

    expect(facadeConfig.family).toBe(manualConfig.family);
    expect(facadeConfig.target).toBe(manualConfig.target);
    expect(facadeConfig.adapter).toBe(manualConfig.adapter);
    expect(facadeConfig.driver).toBe(manualConfig.driver);
    expect(facadeConfig.contract?.output).toBe(manualConfig.contract?.output);
    expect(facadeConfig.contract?.source.inputs).toEqual(manualConfig.contract?.source.inputs);
    expect(typeof facadeConfig.contract?.source.load).toBe('function');
  });

  it('derives output path by swapping .prisma to .json', () => {
    const config = defineConfig({ contract: './foo/bar.prisma' });

    expect(config.contract?.output).toBe('./foo/bar.json');
  });

  it('derives output path by swapping .ts to .json', () => {
    const config = defineConfig({ contract: './foo/bar.ts' });

    expect(config.contract?.output).toBe('./foo/bar.json');
  });

  it('selects TypeScript contract provider for .ts files (distinct from PSL provider)', () => {
    const tsConfig = defineConfig({ contract: './prisma/contract.ts' });
    const pslConfig = defineConfig({ contract: './prisma/contract.prisma' });

    expect(typeof tsConfig.contract?.source.load).toBe('function');
    expect(tsConfig.contract?.output).toBe('./prisma/contract.json');
    expect(tsConfig.contract?.source.inputs).toEqual(['./prisma/contract.ts']);
    expect(tsConfig.contract?.source).not.toBe(pslConfig.contract?.source);
  });

  it('writes into the given output directory when provided', () => {
    const config = defineConfig({
      contract: './prisma/contract.prisma',
      output: './custom/dir',
    });

    expect(config.contract?.output).toBe('custom/dir/contract.json');
  });

  it('always uses the canonical filename contract.json regardless of contract source name', () => {
    const config = defineConfig({
      contract: './prisma/my-schema.prisma',
      output: './out',
    });

    expect(config.contract?.output).toBe('out/contract.json');
  });

  it('threads output through TypeScript contract provider', () => {
    const config = defineConfig({
      contract: './prisma/contract.ts',
      output: './custom/dir',
    });

    expect(config.contract?.output).toBe('custom/dir/contract.json');
    expect(config.contract?.source.inputs).toEqual(['./prisma/contract.ts']);
  });

  it('accepts absolute output', () => {
    const config = defineConfig({
      contract: './prisma/contract.prisma',
      output: '/abs/path/to/dir',
    });

    expect(config.contract?.output).toBe('/abs/path/to/dir/contract.json');
  });

  it('falls back to derived output when output is not provided', () => {
    const config = defineConfig({ contract: './prisma/contract.prisma' });

    expect(config.contract?.output).toBe('./prisma/contract.json');
  });

  it('derives output from the static prefix directory of a glob contract', () => {
    const config = defineConfig({ contract: './prisma/**/*.prisma' });

    expect(config.contract?.output).toBe('./prisma/contract.json');
    expect(config.contract?.source.inputs).toEqual(['./prisma/**/*.prisma']);
  });

  it('derives the same output from a backslash-separated glob contract as its forward-slash twin', () => {
    const forwardSlash = defineConfig({ contract: './prisma/**/*.prisma' });
    const backslash = defineConfig({ contract: '.\\prisma\\**\\*.prisma' });

    expect(backslash.contract?.output).toBe(forwardSlash.contract?.output);
    expect(backslash.contract?.output).toBe('./prisma/contract.json');
  });

  it('passes db config through', () => {
    const config = defineConfig({
      contract: './prisma/contract.prisma',
      db: { connection: 'mongodb://localhost:27017/mydb' },
    });

    expect(config.db?.connection).toBe('mongodb://localhost:27017/mydb');
  });

  it('passes migrations config through', () => {
    const config = defineConfig({
      contract: './prisma/contract.prisma',
      migrations: { dir: 'custom-migrations' },
    });

    expect(config.migrations?.dir).toBe('custom-migrations');
  });

  it('omits db and migrations when they are not provided', () => {
    const config = defineConfig({
      contract: './prisma/contract.prisma',
    });

    expect(Object.hasOwn(config, 'db')).toBe(false);
    expect(Object.hasOwn(config, 'migrations')).toBe(false);
  });

  it('passes extensions through to config', () => {
    const mockExtension = {
      kind: 'extension' as const,
      familyId: 'mongo' as const,
      targetId: 'mongo' as const,
      id: 'test-extension',
      version: '1.0.0',
      create: () => ({
        familyId: 'mongo' as const,
        targetId: 'mongo' as const,
      }),
    };

    const config = defineConfig({
      contract: './prisma/contract.prisma',
      extensions: [mockExtension],
    });

    expect(config.extensions).toContain(mockExtension);
  });
});
