import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig as ormConfig } from '@prisma/orm-postgres/config';

export default definePrismaConfig({
  orm: ormConfig({
    contract: { path: './contract.prisma', databaseVersion: 18 },
    db: {
      connection: 'postgresql://long-spine:long-spine@localhost:5432/long-spine',
    },
    migrations: {
      dir: './migrations',
    },
  }),
});
