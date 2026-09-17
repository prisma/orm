// The config a project switches to after `prisma contract convert`: the same
// database, now read from the Prisma 8 PSL the command wrote.
import { defineConfig as postgres } from '@internal/postgres/config';
import { defineConfig } from '@prisma/cli-engine';

export default defineConfig({
  orm: postgres({
    contract: './contract.prisma',
    db: {
      connection: '{{DB_URL}}',
    },
    migrations: {
      dir: 'migrations',
    },
  }),
});
