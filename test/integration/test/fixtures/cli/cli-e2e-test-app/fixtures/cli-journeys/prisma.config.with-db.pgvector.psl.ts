import postgresAdapter from '@internal/adapter-postgres/control';
import { defineConfig as ormConfig } from '@internal/cli/config-types';
import postgresDriver from '@internal/driver-postgres/control';
import pgvector from '@internal/extension-pgvector/control';
import sql from '@internal/family-sql/control';
import { postgresContractCapabilities } from '@internal/postgres/config';
import { prismaContract } from '@internal/sql-contract-psl/provider';
import postgres from '@internal/target-postgres/control';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { definePrismaConfig } from '@prisma/cli-engine';

export default definePrismaConfig({
  orm: ormConfig({
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensions: [pgvector],
    contract: {
      ...prismaContract('./contract.prisma', {
        capabilities: postgresContractCapabilities({ version: 18 }),
        output: 'contract.json',
        target: postgres,
        createNamespace: postgresCreateNamespace,
      }),
      typesModule: '@internal/postgres/contract-types',
    },
    db: {
      connection: '{{DB_URL}}',
    },
    migrations: {
      dir: 'migrations',
      module: '@internal/postgres/migration',
    },
  }),
});
