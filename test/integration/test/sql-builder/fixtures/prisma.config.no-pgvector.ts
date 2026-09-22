import postgresAdapter from '@internal/adapter-postgres/control';
import { defineConfig as ormConfig } from '@internal/cli/config-types';
import sql from '@internal/family-sql/control';
import postgres from '@internal/target-postgres/control';
import { ok } from '@internal/utils/result';
import { definePrismaConfig } from '@prisma/cli-engine';
import { contract } from './contract-no-pgvector';

export default definePrismaConfig({
  orm: ormConfig({
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    contract: {
      source: {
        load: async () => ok(contract),
      },
      output: 'generated-no-pgvector/contract.json',
    },
  }),
});
