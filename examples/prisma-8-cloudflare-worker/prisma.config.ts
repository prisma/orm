import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig as ormConfig } from '@prisma/orm-postgres/config';
import { EXAMPLE_ROOT, loadLocalEnv } from './scripts/env';

loadLocalEnv(EXAMPLE_ROOT);

export default definePrismaConfig({
  orm: ormConfig({
    contract: './src/prisma/contract.prisma',
    db: {
      // biome-ignore lint/style/noNonNullAssertion: loaded from .env
      connection: process.env['DATABASE_URL']!,
    },
  }),
});
