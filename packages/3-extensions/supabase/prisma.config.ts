import postgresAdapter from '@internal/adapter-postgres/control';
import { defineConfig as ormConfig } from '@internal/cli/config-types';
import sql from '@internal/family-sql/control';
import { prismaContract } from '@internal/sql-contract-psl/provider';
import postgres from '@internal/target-postgres/control';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { definePrismaConfig } from '@prisma/cli-engine';

export default definePrismaConfig({
  orm: ormConfig({
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    contract: prismaContract('src/contract/contract.prisma', {
      target: postgres,
      createNamespace: postgresCreateNamespace,
      defaultControlPolicy: 'external',
    }),
    migrations: {
      dir: 'migrations',
    },
  }),
});
