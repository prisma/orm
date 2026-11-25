import postgresAdapter from '@internal/adapter-postgres/control';
import { defineConfig as coreDefineConfig } from '@internal/config/config-types';
import postgresDriver from '@internal/driver-postgres/control';
import sql from '@internal/family-sql/control';
import { prismaContract } from '@internal/sql-contract-psl/provider';
import { restateTypeDeclarations } from '@internal/target-package-config/type-declarations';
import postgres from '@internal/target-postgres/control';
import postgresPackRef from '@internal/target-postgres/pack';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { describe, expect, it } from 'vitest';
import { defineConfig } from '../../src/config/define-config';

describe('defineConfig facade', () => {
  it('produces config equivalent to manual wiring for .prisma contracts', () => {
    const contractPath = './prisma/contract.prisma';

    const facadeConfig = defineConfig({ contract: { path: contractPath, databaseVersion: 18 } });

    const extensions: [] = [];

    const manualConfig = coreDefineConfig({
      family: sql,
      target: postgres,
      adapter: postgresAdapter,
      driver: postgresDriver,
      extensions,
      contract: prismaContract(contractPath, {
        output: './prisma/contract.json',
        target: postgresPackRef,
        createNamespace: postgresCreateNamespace,
      }),
    });

    expect(facadeConfig.family).toBe(manualConfig.family);
    expect(facadeConfig.target).toEqual(
      restateTypeDeclarations(postgres, '@internal/postgres/contract-types'),
    );
    expect(facadeConfig.adapter).toEqual(
      restateTypeDeclarations(postgresAdapter, '@internal/postgres/contract-types'),
    );
    expect(facadeConfig.driver).toBe(manualConfig.driver);
    expect(facadeConfig.extensions).toEqual(manualConfig.extensions);
    expect(facadeConfig.contract?.output).toBe(manualConfig.contract?.output);
    expect(facadeConfig.contract?.source.inputs).toEqual(manualConfig.contract?.source.inputs);
    expect(typeof facadeConfig.contract?.source.load).toBe('function');
  });

  it('derives output path by swapping .prisma to .json', () => {
    const config = defineConfig({ contract: { path: './foo/bar.prisma', databaseVersion: 18 } });

    expect(config.contract?.output).toBe('./foo/bar.json');
  });

  it('derives output path by swapping .ts to .json', () => {
    const config = defineConfig({ contract: './foo/bar.ts' });

    expect(config.contract?.output).toBe('./foo/bar.json');
  });

  it('selects TypeScript contract provider for .ts files (distinct from PSL provider)', () => {
    const tsConfig = defineConfig({ contract: './prisma/contract.ts' });
    const pslConfig = defineConfig({
      contract: { path: './prisma/contract.prisma', databaseVersion: 18 },
    });

    expect(typeof tsConfig.contract?.source.load).toBe('function');
    expect(tsConfig.contract?.output).toBe('./prisma/contract.json');
    expect(tsConfig.contract?.source.inputs).toEqual(['./prisma/contract.ts']);
    expect(tsConfig.contract?.source).not.toBe(pslConfig.contract?.source);
  });

  it('writes into the given output directory when provided', () => {
    const config = defineConfig({
      contract: { path: './prisma/contract.prisma', databaseVersion: 18 },
      output: './custom/dir',
    });

    expect(config.contract?.output).toBe('custom/dir/contract.json');
  });

  it('always uses the canonical filename contract.json regardless of contract source name', () => {
    const config = defineConfig({
      contract: { path: './prisma/my-schema.prisma', databaseVersion: 18 },
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
      contract: { path: './prisma/contract.prisma', databaseVersion: 18 },
      output: '/abs/path/to/dir',
    });

    expect(config.contract?.output).toBe('/abs/path/to/dir/contract.json');
  });

  it('derives output from the static prefix directory of a glob contract', () => {
    const config = defineConfig({
      contract: { path: './prisma/**/*.prisma', databaseVersion: 18 },
    });

    expect(config.contract?.output).toBe('./prisma/contract.json');
    expect(config.contract?.source.inputs).toEqual(['./prisma/**/*.prisma']);
  });

  it('derives the same output from a backslash-separated glob contract as its forward-slash twin', () => {
    const forwardSlash = defineConfig({
      contract: { path: './prisma/**/*.prisma', databaseVersion: 18 },
    });
    const backslash = defineConfig({
      contract: { path: '.\\prisma\\**\\*.prisma', databaseVersion: 18 },
    });

    expect(backslash.contract?.output).toBe(forwardSlash.contract?.output);
    expect(backslash.contract?.output).toBe('./prisma/contract.json');
  });

  it('passes db config through', () => {
    const config = defineConfig({
      contract: { path: './prisma/contract.prisma', databaseVersion: 18 },
      db: { connection: 'postgres://localhost:5432/db' },
    });

    expect(config.db?.connection).toBe('postgres://localhost:5432/db');
  });

  it('passes migrations config through', () => {
    const config = defineConfig({
      contract: { path: './prisma/contract.prisma', databaseVersion: 18 },
      migrations: { dir: 'custom-migrations' },
    });

    expect(config.migrations?.dir).toBe('custom-migrations');
  });

  it('omits db when it is not provided', () => {
    const config = defineConfig({
      contract: { path: './prisma/contract.prisma', databaseVersion: 18 },
    });

    expect(Object.hasOwn(config, 'db')).toBe(false);
  });

  it('names its own modules for generated files', () => {
    const config = defineConfig({
      contract: { path: './prisma/contract.prisma', databaseVersion: 18 },
    });

    expect(config.contract?.typesModule).toBe('@internal/postgres/contract-types');
    expect(config.migrations).toEqual({ module: '@internal/postgres/migration' });
  });

  it('names its own modules alongside a given migrations dir and a ready contract config', () => {
    const config = defineConfig({
      contract: prismaContract('./prisma/contract.prisma', {
        output: './prisma/contract.json',
        target: postgresPackRef,
        createNamespace: postgresCreateNamespace,
      }),
      migrations: { dir: 'db' },
    });

    expect(config.contract?.typesModule).toBe('@internal/postgres/contract-types');
    expect(config.migrations).toEqual({ dir: 'db', module: '@internal/postgres/migration' });
  });

  it('passes extensions through to config', () => {
    const mockExtension = {
      kind: 'extension' as const,
      familyId: 'sql' as const,
      targetId: 'postgres' as const,
      id: 'test-extension',
      version: '1.0.0',
      create: () => ({
        familyId: 'sql' as const,
        targetId: 'postgres' as const,
      }),
    };

    const config = defineConfig({
      contract: { path: './prisma/contract.prisma', databaseVersion: 18 },
      extensions: [mockExtension],
    });

    expect(config.extensions).toContain(mockExtension);
  });

  it('passes formatter config through', () => {
    const config = defineConfig({
      contract: { path: './prisma/contract.prisma', databaseVersion: 18 },
      formatter: { indent: 'tab', newline: 'CRLF' },
    });

    expect(config.formatter).toEqual({ indent: 'tab', newline: 'CRLF' });
  });

  it('leaves formatter out when it is not given', () => {
    const config = defineConfig({
      contract: { path: './prisma/contract.prisma', databaseVersion: 18 },
    });

    expect(Object.hasOwn(config, 'formatter')).toBe(false);
  });
});
