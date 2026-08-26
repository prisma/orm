import postgresAdapter from '@internal/adapter-postgres/control';
import { defineConfig as ormConfig } from '@internal/cli/config-types';
import postgresDriver from '@internal/driver-postgres/control';
import sql from '@internal/family-sql/control';
import { prismaContract } from '@internal/sql-contract-psl/provider';
import postgres from '@internal/target-postgres/control';
import postgresPackRef from '@internal/target-postgres/pack';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { definePrismaConfig } from '@prisma/cli-engine';
import supabasePack from '../../src/exports/pack';

// Variant contract state for the skeleton e2e (renamed-policy). Emitted through the
// real pipeline via this package's `emit` script — never hand-edited.
export default definePrismaConfig({
  orm: ormConfig({
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensions: [supabasePack],
    contract: prismaContract('./renamed-policy/contract.prisma', {
      output: 'renamed-policy/contract.json',
      target: postgresPackRef,
      createNamespace: postgresCreateNamespace,
    }),
    migrations: {
      dir: 'migrations',
    },
  }),
});
