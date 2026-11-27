import type { PrismaConfig } from '@internal/config/config-types';
import { expectTypeOf, it } from 'vitest';
import { defineConfig } from '../../src/config/define-config';
import { prisma7Schema } from '../../src/config/prisma7-schema';
import { postgres18, postgresDriver } from '../../src/contract/contract-capabilities';

const required = [...postgres18, ...postgresDriver];

it('accepts a contract path and a ContractConfig', () => {
  expectTypeOf(
    defineConfig({ contract: { path: 'x.prisma', requiredCapabilities: required } }),
  ).toEqualTypeOf<PrismaConfig<'sql', 'postgres'>>();
  expectTypeOf(
    defineConfig({ contract: prisma7Schema('x.prisma', { requiredCapabilities: required }) }),
  ).toEqualTypeOf<PrismaConfig<'sql', 'postgres'>>();
  // @ts-expect-error a number is neither a path nor a ContractConfig
  defineConfig({ contract: 42 });
});

it('reads prisma7Schema from the schema path and the required capabilities, which a call written before the list existed leaves out; the output directory is set on defineConfig', () => {
  prisma7Schema('x.prisma', { requiredCapabilities: ['sql.returning'] });
  prisma7Schema('x.prisma');
  prisma7Schema('x.prisma', {});
  // @ts-expect-error a capability is a key with a namespace
  prisma7Schema('x.prisma', { requiredCapabilities: ['returning'] });
  // @ts-expect-error the database version is not an option
  prisma7Schema('x.prisma', { databaseVersion: 18 });
});

it('takes a Prisma schema path without a list, as a release candidate wrote it, and refuses a TypeScript entry with one', () => {
  defineConfig({ contract: './prisma/contract.prisma' });
  defineConfig({ contract: { path: './prisma/contract.prisma' } });
  // @ts-expect-error a TypeScript contract lists its required capabilities in defineContract
  defineConfig({ contract: { path: './prisma/contract.ts', requiredCapabilities: required } });
  defineConfig({ contract: { path: './prisma/contract.ts' } });
  defineConfig({ contract: './prisma/contract.ts' });
});
