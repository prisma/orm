import type { PrismaNextConfig } from '@internal/config/config-types';
import { expectTypeOf, it } from 'vitest';
import { defineConfig } from '../../src/config/define-config';
import { prisma6Schema } from '../../src/config/prisma6-schema';

it('accepts a contract path and a ContractConfig', () => {
  expectTypeOf(defineConfig({ contract: 'x.prisma' })).toEqualTypeOf<
    PrismaNextConfig<'mongo', 'mongo'>
  >();
  expectTypeOf(defineConfig({ contract: prisma6Schema('x.prisma') })).toEqualTypeOf<
    PrismaNextConfig<'mongo', 'mongo'>
  >();
  // @ts-expect-error a number is neither a path nor a ContractConfig
  defineConfig({ contract: 42 });
});

it('reads prisma6Schema from the schema path alone; the output directory is set on defineConfig', () => {
  expectTypeOf(prisma6Schema).parameters.toEqualTypeOf<[schemaPath: string]>();
});
