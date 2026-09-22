import postgresAdapter from '@internal/adapter-postgres/control';
import { defineConfig as ormConfig } from '@internal/cli/config-types';
import sql from '@internal/family-sql/control';
import postgres from '@internal/target-postgres/control';
import { definePrismaConfig } from '@prisma/cli-engine';
import { contract } from './contract';

export default definePrismaConfig({
  orm: ormConfig({
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    extensions: [],
    contract: {
      source: {
        load: async () => ({ ok: true as const, value: contract }),
      },
      output: 'output/contract.json',
      types: 'output/contract.d.ts',
    },
    migrations: {
      dir: 'migrations',
    },
  }),
});
