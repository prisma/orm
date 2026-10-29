import postgresAdapter from '@internal/adapter-postgres/control';
import { defineConfig as ormConfig } from '@internal/cli/config-types';
import postgresDriver from '@internal/driver-postgres/control';
import pack from '@internal/extension-pgvector/control';
import sql from '@internal/family-sql/control';
import postgres from '@internal/target-postgres/control';
import { definePrismaConfig } from '@prisma/cli-engine';
import { contract } from './contract';

// An app contract beside one extension pack's contract space, on PGlite. A test
// swaps the pgvector import for the pack it covers.
export default definePrismaConfig({
  orm: ormConfig({
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensions: [pack],
    contract: {
      source: {
        format: 'typescript',
        load: async () => ({ ok: true, value: contract }),
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
