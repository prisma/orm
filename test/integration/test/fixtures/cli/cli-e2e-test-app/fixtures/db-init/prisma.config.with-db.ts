import postgresAdapter from '@internal/adapter-postgres/control';
import { defineConfig as ormConfig } from '@internal/cli/config-types';
import postgresDriver from '@internal/driver-postgres/control';
import sql from '@internal/family-sql/control';
import postgres from '@internal/target-postgres/control';
import { definePrismaConfig } from '@prisma/cli-engine';
import { contract } from './contract';

// This config includes driver and db.connection
// The db.connection will be replaced at runtime in tests
export default definePrismaConfig({
  orm: ormConfig({
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensions: [],
    contract: {
      source: {
        load: async () => ({ ok: true, value: contract }),
      },
      output: 'src/prisma/contract.json',
    },
    db: {
      connection: '{{DB_URL}}', // Placeholder to be replaced in tests
    },
  }),
});
