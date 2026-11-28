import { definePrismaConfig } from '@prisma/cli-engine';
import { prismaContract } from '@prisma/orm-family-sql/contract-psl/provider';
import { defineConfig as ormConfig } from '@prisma/orm-postgres/config';
import postgresPackRef from '@prisma/orm-postgres/target/pack';
import { postgresCreateNamespace } from '@prisma/orm-postgres/target/types';

export default definePrismaConfig({
  orm: ormConfig({
    contract: prismaContract('./src/contract.prisma', {
      output: 'src/contract.json',
      target: postgresPackRef,
      createNamespace: postgresCreateNamespace,
    }),
  }),
});
