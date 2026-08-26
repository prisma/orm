import 'dotenv/config';
import { definePrismaConfig } from '@prisma/cli-engine';
import pgvector from '@prisma/orm-extension-pgvector/control';
import { defineConfig as ormConfig } from '@prisma/orm-postgres/config';
import { engagementStatsControl } from './src/extensions/engagement-stats';

export default definePrismaConfig({
  orm: ormConfig({
    contract: './prisma/contract.ts',
    output: './src/prisma',
    extensions: [pgvector, engagementStatsControl],
    db: {
      // biome-ignore lint/style/noNonNullAssertion: loaded from .env
      connection: process.env['DATABASE_URL']!,
    },
  }),
});
