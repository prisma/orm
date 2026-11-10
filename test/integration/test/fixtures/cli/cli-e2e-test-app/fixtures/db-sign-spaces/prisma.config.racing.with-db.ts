import postgresAdapter from '@internal/adapter-postgres/control';
import { defineConfig as ormConfig } from '@internal/cli/config-types';
import postgresDriver from '@internal/driver-postgres/control';
import sql from '@internal/family-sql/control';
import postgres from '@internal/target-postgres/control';
import { definePrismaConfig } from '@prisma/cli-engine';
import testContractSpaceExtension from '../../../../contract-space-fixture/control';
import { racingDriver } from '../fixtures/db-sign-spaces/racing-driver';
import { contract } from './contract';

// The app and one contract-space extension on Postgres, through a driver that
// runs the statement in race.json just before its first transaction.
export default definePrismaConfig({
  orm: ormConfig({
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    driver: racingDriver(postgresDriver, new URL('./race.json', import.meta.url)),
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
