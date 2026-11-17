import { readFileSync } from 'node:fs';
import postgresAdapter from '@internal/adapter-postgres/control';
import { defineConfig as ormConfig } from '@internal/cli/config-types';
import postgresDriver from '@internal/driver-postgres/control';
import sql from '@internal/family-sql/control';
import postgres from '@internal/target-postgres/control';
import { definePrismaConfig } from '@prisma/cli-engine';

// The contract source reads a contract JSON file, so `contract emit` loads a
// contract written by an earlier emit.
export default definePrismaConfig({
  orm: ormConfig({
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensions: [],
    contract: {
      source: {
        format: 'typescript',
        load: async () => ({
          ok: true,
          value: JSON.parse(
            readFileSync(new URL('./contract-input.json', import.meta.url), 'utf8'),
          ),
        }),
      },
      output: 'output/contract.json',
    },
    db: { connection: '{{DB_URL}}' },
    migrations: { dir: 'migrations' },
  }),
});
