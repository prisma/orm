import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig as ormConfig } from '@prisma/orm-postgres/config';

export default definePrismaConfig({
  orm: ormConfig({
    contract: { path: './contract.prisma', version: 18 },
    db: {
      connection: 'postgresql://wide-fan:wide-fan@localhost:5432/wide-fan',
    },
    migrations: {
      dir: './migrations',
    },
  }),
});
