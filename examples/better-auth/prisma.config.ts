import 'dotenv/config';
import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig as ormConfig, postgres18, postgresDriver } from '@prisma/orm-postgres/config';

export default definePrismaConfig({
  orm: ormConfig({
    contract: {
      path: './prisma/contract.prisma',
      requiredCapabilities: [...postgres18, ...postgresDriver],
    },
    ...(process.env['DATABASE_URL'] !== undefined && {
      db: { connection: process.env['DATABASE_URL'] },
    }),
  }),
});
