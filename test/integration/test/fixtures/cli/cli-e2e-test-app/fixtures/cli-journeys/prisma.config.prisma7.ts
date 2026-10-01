// The workspace name of `@prisma/orm-postgres/config`: every fixture in this
// app stays on one import root (ADR 242), and the published shell re-exports
// exactly these two functions.
import { defineConfig as postgres, prisma7Schema } from '@internal/postgres/config';
import { definePrismaConfig } from '@prisma/cli-engine';

export default definePrismaConfig({
  orm: postgres({
    contract: prisma7Schema('./schema.prisma'),
    db: {
      connection: '{{DB_URL}}',
    },
    migrations: {
      dir: 'migrations',
    },
  }),
});
