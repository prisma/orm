// The config a project switches to after `prisma contract print`: the same
// database, now read from the Prisma 8 PSL the command wrote.
import { defineConfig as postgres, postgres18, postgresDriver } from '@internal/postgres/config';
import { definePrismaConfig } from '@prisma/cli-engine';

export default definePrismaConfig({
  orm: postgres({
    contract: {
      path: './contract.prisma',
      requiredCapabilities: [...postgres18, ...postgresDriver],
    },
    db: {
      connection: '{{DB_URL}}',
    },
    migrations: {
      dir: 'migrations',
    },
  }),
});
