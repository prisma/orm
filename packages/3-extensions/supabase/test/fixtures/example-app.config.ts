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

// The fixture app the hermetic integration tests exercise (Profile with a
// cross-space FK into auth.users and RLS policies) — the same contract shape
// examples/supabase ships. Emitted through the real pipeline via this
// package's `emit` script — never hand-edited.
export default definePrismaConfig({
  orm: ormConfig({
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensions: [supabasePack],
    contract: prismaContract('./example-app/contract.prisma', {
      output: 'example-app/contract.json',
      target: postgresPackRef,
      createNamespace: postgresCreateNamespace,
    }),
    migrations: {
      dir: 'migrations',
    },
  }),
});
