import 'dotenv/config';
import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig as ormConfig } from '@prisma/orm-postgres/config';

export default definePrismaConfig({
  orm: ormConfig({
    contract: { path: './prisma/contract.prisma', version: 18 },
    ...(process.env['DATABASE_URL'] !== undefined && {
      db: { connection: process.env['DATABASE_URL'] },
    }),
  }),
});
