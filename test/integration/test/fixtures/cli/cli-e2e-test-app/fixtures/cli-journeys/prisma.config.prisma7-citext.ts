// A Prisma 7 schema with @db.Citext columns and extensions = [citext], read with the citext pack
// composed, as `@prisma/orm-postgres-contrib/citext/control` composes it.

import citext from '@internal/extension-citext/control';
import { defineConfig as postgres, prisma7Schema } from '@internal/postgres/config';
import { definePrismaConfig } from '@prisma/cli-engine';

export default definePrismaConfig({
  orm: postgres({
    contract: prisma7Schema('./schema.prisma'),
    extensions: [citext],
    db: {
      connection: '{{DB_URL}}',
    },
    migrations: {
      dir: 'migrations',
    },
  }),
});
