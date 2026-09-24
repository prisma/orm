import postgresAdapter from '@internal/adapter-postgres/control';
import { defineConfig as ormConfig } from '@internal/cli/config-types';
import sql from '@internal/family-sql/control';
import postgres from '@internal/target-postgres/control';
import { definePrismaConfig } from '@prisma/cli-engine';
import { contract } from './contract';

// This config includes db.connection but no driver - that is what tests using
// it assert on (CONFIG.DRIVER_REQUIRED). The driver field is optional, so the
// config loads cleanly and the command-level driver requirement fires.
export default definePrismaConfig({
  orm: ormConfig({
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    extensions: [],
    contract: {
      source: {
        load: async () => ({ ok: true, value: contract }),
      },
      output: 'output/contract.json',
    },
    db: {
      connection: '{{DB_URL}}', // Placeholder to be replaced in tests
    },
  }),
});
