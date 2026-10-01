import 'dotenv/config';
import { defineConfig } from '@prisma/prisma7/config';

// `prisma7 generate` needs no database; `prisma7 migrate deploy` reports a
// missing URL itself.
const url = process.env['DATABASE_URL'];

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  ...(url === undefined ? {} : { datasource: { url } }),
});
