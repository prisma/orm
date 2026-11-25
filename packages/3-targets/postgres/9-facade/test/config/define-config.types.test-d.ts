import type { PrismaConfig } from '@internal/config/config-types';
import { expectTypeOf, it } from 'vitest';
import { defineConfig } from '../../src/config/define-config';
import { prisma7Schema } from '../../src/config/prisma7-schema';

it('accepts a contract path and a ContractConfig', () => {
  expectTypeOf(defineConfig({ contract: { path: 'x.prisma', version: 18 } })).toEqualTypeOf<
    PrismaConfig<'sql', 'postgres'>
  >();
  expectTypeOf(
    defineConfig({ contract: prisma7Schema('x.prisma', { version: 18 }) }),
  ).toEqualTypeOf<PrismaConfig<'sql', 'postgres'>>();
  // @ts-expect-error a number is neither a path nor a ContractConfig
  defineConfig({ contract: 42 });
});

it('reads prisma7Schema from the schema path and the database version; the output directory is set on defineConfig', () => {
  prisma7Schema('x.prisma', {
    version: 15,
    capabilities: [{ sql: { interactiveTransactions: true } }],
  });
  // @ts-expect-error the version is required
  prisma7Schema('x.prisma');
  // @ts-expect-error the version is required
  prisma7Schema('x.prisma', {});
  // @ts-expect-error 14 is not a supported PostgreSQL version
  prisma7Schema('x.prisma', { version: 14 });
});
