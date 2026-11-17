import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig as ormConfig } from '@prisma/orm-postgres/config';

export default definePrismaConfig({
  orm: ormConfig({
    contract: './contract.prisma',
    db: {
      connection:
        'postgresql://converging-branches:converging-branches@localhost:5432/converging-branches',
    },
    migrations: {
      dir: './migrations',
    },
  }),
});
