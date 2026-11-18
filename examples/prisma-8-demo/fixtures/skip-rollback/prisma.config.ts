import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig as ormConfig } from '@prisma/orm-postgres/config';

export default definePrismaConfig({
  orm: ormConfig({
    contract: './contract.prisma',
    db: {
      connection: 'postgresql://skip-rollback:skip-rollback@localhost:5432/skip-rollback',
    },
    migrations: {
      dir: './migrations',
    },
  }),
});
