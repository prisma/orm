import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig as ormConfig, postgres18, postgresDriver } from '@prisma/orm-postgres/config';

export default definePrismaConfig({
  orm: ormConfig({
    contract: {
      path: './contract.prisma',
      requiredCapabilities: [...postgres18, ...postgresDriver],
    },
    db: {
      connection:
        'postgresql://converging-branches:converging-branches@localhost:5432/converging-branches',
    },
    migrations: {
      dir: './migrations',
    },
  }),
});
