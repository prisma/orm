import 'dotenv/config';
import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig as definePostgresConfig } from '@prisma/orm-postgres/config';

// Phase 4 of the upgrade guide: `prisma contract convert` wrote
// generated/prisma8/contract.prisma from prisma/schema.prisma; this config
// reads that file instead of the Prisma 7 schema and emits the same
// generated/prisma8/contract.json. Once the cutover is done it replaces
// prisma.config.ts.
export default definePrismaConfig({
  orm: definePostgresConfig({
    contract: 'generated/prisma8/contract.prisma',
    db: {
      // biome-ignore lint/style/noNonNullAssertion: loaded from .env
      connection: process.env['DATABASE_URL']!,
    },
  }),
});
