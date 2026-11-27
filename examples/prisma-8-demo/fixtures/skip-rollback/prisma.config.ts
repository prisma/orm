import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig as ormConfig, postgres18, postgresDriver } from '@prisma/orm-postgres/config';

export default definePrismaConfig({
  orm: ormConfig({
    contract: {
      path: './contract.prisma',
      requiredCapabilities: [...postgres18, ...postgresDriver],
    },
    db: {
      connection: 'postgresql://skip-rollback:skip-rollback@localhost:5432/skip-rollback',
    },
    migrations: {
      dir: './migrations',
    },
  }),
});
