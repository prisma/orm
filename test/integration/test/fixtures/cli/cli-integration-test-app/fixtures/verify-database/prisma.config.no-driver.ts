import postgresAdapter from '@internal/adapter-postgres/control';
import { defineConfig as ormConfig } from '@internal/cli/config-types';
import sql from '@internal/family-sql/control';
import { typescriptContract } from '@internal/sql-contract-ts/config-types';
import postgres from '@internal/target-postgres/control';
import { definePrismaConfig } from '@prisma/cli-engine';
import { contract } from './contract';

// This config includes db.connection and family with readMarker but no driver
export default definePrismaConfig({
  orm: ormConfig({
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    extensions: [],
    contract: typescriptContract(contract, 'output/contract.json'),
    db: {
      connection: '{{DB_URL}}', // Placeholder to be replaced in tests
    },
  }),
});
