import pgvector from '@internal/extension-pgvector/control';
import { defineConfig as postgres, prisma7Schema } from '@internal/postgres/config';
import { definePrismaConfig } from '@prisma/cli-engine';

export default definePrismaConfig({
  orm: postgres({
    contract: prisma7Schema('./schema.prisma'),
    extensions: [pgvector],
    db: {
      connection: '{{DB_URL}}',
    },
    migrations: {
      dir: 'migrations',
    },
  }),
});
