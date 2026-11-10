// The workspace name of `@prisma/orm-mongo/config`: every fixture in this
// app stays on one import root (ADR 242).
import { defineConfig as mongo, prisma6Schema } from '@internal/mongo/config';
import { definePrismaConfig } from '@prisma/cli-engine';

export default definePrismaConfig({
  orm: mongo({
    contract: prisma6Schema('./schema.prisma'),
    db: {
      connection: '{{DB_URL}}',
    },
    migrations: {
      dir: 'migrations',
    },
  }),
});
