import mysqlAdapter, {
  createMysqlControlAdapter,
  readMysqlCatalog,
} from '@internal/adapter-mysql/control';
import type { PrismaNextConfig } from '@internal/config/config-types';
import { createMysqlControlDriverDescriptor } from '@internal/driver-mysql/control';
import sql, { type SqlControlAdapterDescriptor } from '@internal/family-sql/control';
import type { TargetPackRef } from '@internal/framework-components/components';
import { createMysqlControlTargetDescriptor } from '@internal/target-mysql/control';
import mysqlPackRef from '@internal/target-mysql/pack';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { createMysqlDefineConfig } from '../../src/config/define-config';

const mariadbMeta = { ...mysqlPackRef, targetId: 'mariadb', id: 'mariadb' } as const;

const mariadbComponents = {
  pack: mariadbMeta satisfies TargetPackRef<'sql', 'mariadb'>,
  target: createMysqlControlTargetDescriptor({
    descriptorMeta: mariadbMeta,
    migrationModule: '@internal/mariadb/migration',
  }),
  adapter: {
    ...mysqlAdapter,
    targetId: 'mariadb',
    id: 'mariadb',
    create: (stack) => createMysqlControlAdapter(stack, { readCatalog: readMysqlCatalog }),
  } satisfies SqlControlAdapterDescriptor<'mariadb'>,
  driver: createMysqlControlDriverDescriptor('mariadb'),
};

describe('createMysqlDefineConfig', () => {
  it('builds the defineConfig of a target that extends MySQL from its components', () => {
    const config = createMysqlDefineConfig(mariadbComponents)({
      contract: './prisma/contract.prisma',
      db: { connection: 'mysql://root@localhost:3306/app' },
    });
    expectTypeOf(config).toEqualTypeOf<PrismaNextConfig<'sql', 'mariadb'>>();
    expect({
      family: config.family,
      target: config.target,
      adapter: config.adapter,
      driver: config.driver,
      output: config.contract?.output,
      inputs: config.contract?.source.inputs,
    }).toEqual({
      family: sql,
      target: mariadbComponents.target,
      adapter: mariadbComponents.adapter,
      driver: mariadbComponents.driver,
      output: './prisma/contract.json',
      inputs: ['./prisma/contract.prisma'],
    });
  });

  it.each([
    ['a glob', './prisma/**', './prisma/contract.json'],
    ['a folder', './prisma', './prisma.json'],
  ])('builds %s contract path through the Prisma schema provider', (_kind, contract, output) => {
    const config = createMysqlDefineConfig(mariadbComponents)({ contract });
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
    expect(() => createMysqlDefineConfig(mariadbComponents)({ contract })).toThrow(
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
});
