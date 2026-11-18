import mariadbAdapter from '@internal/adapter-mariadb/control';
import mariadbDriver from '@internal/driver-mariadb/control';
import sql from '@internal/family-sql/control';
import mariadb from '@internal/target-mariadb/control';
import { restateTypeDeclarations } from '@internal/target-package-config/type-declarations';
import { describe, expect, it } from 'vitest';
import { defineConfig } from '../src/config/define-config';
import { emitFixture } from './emit';

describe('defineConfig for MariaDB', () => {
  it('wires the MariaDB target, adapter and driver', () => {
    const config = defineConfig({
      contract: './prisma/contract.prisma',
      db: { connection: 'mysql://root@localhost:3306/app' },
      migrations: { dir: './migrations' },
    });
    expect({
      family: config.family,
      target: config.target,
      adapter: config.adapter,
      driver: config.driver,
      extensions: config.extensions,
      output: config.contract?.output,
      inputs: config.contract?.source.inputs,
      db: config.db,
      migrations: config.migrations,
    }).toEqual({
      family: sql,
      target: mariadb,
      adapter: restateTypeDeclarations(mariadbAdapter, '@internal/mariadb/contract-types'),
      driver: mariadbDriver,
      extensions: [],
      output: './prisma/contract.json',
      inputs: ['./prisma/contract.prisma'],
      db: { connection: 'mysql://root@localhost:3306/app' },
      migrations: { dir: './migrations', module: '@internal/mariadb/migration' },
    });
  });

  it.each([
    ['a glob', './prisma/**', './prisma/contract.json'],
    ['a folder', './prisma', './prisma.json'],
  ])('builds %s contract path through the Prisma schema provider', (_kind, contract, output) => {
    const config = defineConfig({ contract });
    expect({ output: config.contract?.output, inputs: config.contract?.source.inputs }).toEqual({
      output,
      inputs: [contract],
    });
  });

  it.each([
    './prisma/contract.ts',
    './prisma/contract.mts',
    './prisma/contract.cts',
    './prisma/contract.tsx',
  ])('refuses the TypeScript contract %s', (contract) => {
    expect(() => defineConfig({ contract })).toThrow(
      expect.objectContaining({
        name: 'StructuredError',
        code: 'CONFIG.VALIDATION_FAILED',
        message: `defineConfig for target "mariadb" cannot build a contract from "${contract}", which is a TypeScript contract.`,
        why: 'Target "mariadb" builds contracts from Prisma schemas and does not support TypeScript contracts.',
        fix: 'Point `contract` at a Prisma schema: a .prisma file, a folder of them, or a glob.',
        meta: { contract },
      }),
    );
  });

  it('emits a PSL contract for target mariadb, with no returning or one-query include capability and typed by its contract-types module', async () => {
    const { contract, contractDts } = await emitFixture('example');
    expect({
      target: contract.target,
      capabilities: contract.capabilities,
      codecTypes:
        /^import type \{[^}]*\bCodecTypes as MariadbTypes\b[^}]*\} from '@internal\/mariadb\/contract-types';$/m.test(
          contractDts,
        ),
    }).toEqual({
      target: 'mariadb',
      capabilities: {
        sql: {
          defaultInInsert: true,
          enums: true,
          foreignKeys: true,
          jsonAgg: true,
          limit: true,
          orderBy: true,
          subqueryReadsWrittenTable: true,
        },
      },
      codecTypes: true,
    });
  });
});

describe('the modules generated files import from', () => {
  it('names its own contract-types and migration modules', () => {
    const config = defineConfig({ contract: './prisma/contract.prisma' });

    expect([config.contract?.typesModule, config.migrations]).toEqual([
      '@internal/mariadb/contract-types',
      { module: '@internal/mariadb/migration' },
    ]);
  });
});
