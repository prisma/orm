import type { PrismaNextConfig } from '@internal/config/config-types';
import { expectTypeOf, it } from 'vitest';
import { defineConfig } from '../../src/config/define-config';
import { prisma7Schema } from '../../src/config/prisma7-schema';

it('accepts a contract path and a ContractConfig', () => {
  expectTypeOf(defineConfig({ contract: 'x.prisma' })).toEqualTypeOf<
    PrismaNextConfig<'sql', 'postgres'>
  >();
  expectTypeOf(defineConfig({ contract: prisma7Schema('x.prisma') })).toEqualTypeOf<
    PrismaNextConfig<'sql', 'postgres'>
  >();
  // @ts-expect-error a number is neither a path nor a ContractConfig
  defineConfig({ contract: 42 });
});

it('reads prisma7Schema from the schema path alone; the output directory is set on defineConfig', () => {
  expectTypeOf(prisma7Schema).parameters.toEqualTypeOf<[schemaPath: string]>();
});
