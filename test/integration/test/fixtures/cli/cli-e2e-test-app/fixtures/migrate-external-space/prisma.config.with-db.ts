import postgresAdapter from '@internal/adapter-postgres/control';
import { defineConfig as ormConfig } from '@internal/cli/config-types';
import postgresDriver from '@internal/driver-postgres/control';
import sql from '@internal/family-sql/control';
import postgres from '@internal/target-postgres/control';
import { definePrismaConfig } from '@prisma/cli-engine';
import testExternalSpaceExtension from '../../../../contract-space-fixture/external-space';
import { contract } from './contract';

// Declares an all-external contract-space extension (head ref, zero
// migration packages) alongside a normal app contract — the Supabase
// shape. Used by the migrate external-space e2e tests.
export default definePrismaConfig({
  orm: ormConfig({
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensions: [testExternalSpaceExtension],
    contract: {
      source: {
        load: async () => ({ ok: true as const, value: contract }),
      },
      output: 'output/contract.json',
      types: 'output/contract.d.ts',
    },
    db: {
      connection: '{{DB_URL}}',
    },
    migrations: {
      dir: 'migrations',
    },
  }),
});
