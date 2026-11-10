import postgresAdapter from '@internal/adapter-postgres/control';
import { defineConfig as ormConfig } from '@internal/cli/config-types';
import postgresDriver from '@internal/driver-postgres/control';
import sql from '@internal/family-sql/control';
import postgres from '@internal/target-postgres/control';
import { definePrismaConfig } from '@prisma/cli-engine';
import testContractSpaceExtension from '../../../../contract-space-fixture/control';
import { contract } from './contract';

// An app contract beside one contract-space extension, on Postgres. Used by
// the `db sign` journeys that re-sign both spaces at once.
export default definePrismaConfig({
  orm: ormConfig({
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensions: [testContractSpaceExtension],
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
