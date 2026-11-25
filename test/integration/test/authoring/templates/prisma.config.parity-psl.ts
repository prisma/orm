import postgresAdapter from '@internal/adapter-postgres/control';
import { defineConfig as ormConfig } from '@internal/cli/config-types';
import postgresDriver from '@internal/driver-postgres/control';
import sql from '@internal/family-sql/control';
import { postgresContractCapabilities } from '@internal/postgres/config';
import { prismaContract } from '@internal/sql-contract-psl/provider';
import postgres from '@internal/target-postgres/control';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { definePrismaConfig } from '@prisma/cli-engine';
import { workspaceTypesModule } from '@repo/test-utils';
import { extensions } from './packs';

export default definePrismaConfig({
  orm: ormConfig({
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensions,
    contract: {
      ...prismaContract('./schema.prisma', {
        capabilities: postgresContractCapabilities({ version: 18 }),
        output: 'output/contract.json',
        target: postgres,
        createNamespace: postgresCreateNamespace,
      }),
      typesModule: workspaceTypesModule.postgres,
    },
  }),
});
