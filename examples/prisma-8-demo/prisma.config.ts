import 'dotenv/config';
import { definePrismaConfig } from '@prisma/cli-engine';
import pgvector from '@prisma/orm-extension-pgvector/control';
import { defineConfig as ormConfig } from '@prisma/orm-postgres/config';
import { engagementStatsControl } from './src/extensions/engagement-stats';

export default definePrismaConfig({
  orm: ormConfig({
    contract: './src/prisma/contract.prisma',
    // `engagementStatsControl` contributes the `stddev` aggregate operation, so
    // the emitted types carry it. Its runtime half is composed in `src/prisma/db.ts`.
    extensions: [pgvector, engagementStatsControl],
    db: {
      // biome-ignore lint/style/noNonNullAssertion: loaded from .env
      connection: process.env['DATABASE_URL']!,
    },
  }),
});
