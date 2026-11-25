import postgresAdapter from '@internal/adapter-postgres/control';
import { defineConfig as ormConfig } from '@internal/cli/config-types';
import postgresDriver from '@internal/driver-postgres/control';
import sql from '@internal/family-sql/control';
import { postgresContractCapabilities } from '@internal/postgres/config';
import { prismaContract } from '@internal/sql-contract-psl/provider';
import postgres from '@internal/target-postgres/control';
import postgresPackRef from '@internal/target-postgres/pack';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { definePrismaConfig } from '@prisma/cli-engine';
import { workspaceTypesModule } from '@repo/test-utils';

export default definePrismaConfig({
  orm: ormConfig({
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    driver: postgresDriver,
    contract: {
      ...prismaContract('./schema.prisma', {
        capabilities: postgresContractCapabilities({ version: 18 }),
        output: 'generated/contract.json',
        target: postgresPackRef,
        createNamespace: postgresCreateNamespace,
      }),
      typesModule: workspaceTypesModule.postgres,
    },
  }),
});
