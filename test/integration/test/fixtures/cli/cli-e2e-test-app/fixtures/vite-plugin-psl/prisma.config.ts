import postgresAdapter from '@internal/adapter-postgres/control';
import { defineConfig as ormConfig } from '@internal/cli/config-types';
import postgresDriverDescriptor from '@internal/driver-postgres/control';
import sql from '@internal/family-sql/control';
import {
  postgres18,
  postgresContractCapabilities,
  postgresDriver,
} from '@internal/postgres/config';
import { prismaContract } from '@internal/sql-contract-psl/provider';
import postgres from '@internal/target-postgres/control';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { definePrismaConfig } from '@prisma/cli-engine';

export default definePrismaConfig({
  orm: ormConfig({
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    driver: postgresDriverDescriptor,
    extensions: [],
    contract: {
      ...prismaContract('./contract.prisma', {
        capabilities: postgresContractCapabilities([...postgres18, ...postgresDriver]),
        output: 'output/contract.json',
        target: postgres,
        createNamespace: postgresCreateNamespace,
      }),
      typesModule: '@internal/postgres/contract-types',
    },
  }),
});
