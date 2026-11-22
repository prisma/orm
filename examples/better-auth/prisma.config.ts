import 'dotenv/config';
import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig as ormConfig } from '@prisma/orm-postgres/config';

export default definePrismaConfig({
  orm: ormConfig({
    contract: './prisma/contract.prisma',
    output: './src/prisma',
    ...(process.env['DATABASE_URL'] !== undefined && {
      db: { connection: process.env['DATABASE_URL'] },
    }),
  }),
});
