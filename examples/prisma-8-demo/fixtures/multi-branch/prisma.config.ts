import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig as ormConfig } from '@prisma/orm-postgres/config';

export default definePrismaConfig({
  orm: ormConfig({
    contract: { path: './contract.prisma', version: 18 },
    db: {
      connection: 'postgresql://multi-branch:multi-branch@localhost:5432/multi-branch',
    },
    migrations: {
      dir: './migrations',
    },
  }),
});
