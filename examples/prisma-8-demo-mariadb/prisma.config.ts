import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig as ormConfig } from '@prisma/orm-mariadb/config';

const connection = process.env['MARIADB_URL'];

export default definePrismaConfig({
  orm: ormConfig({
    contract: './prisma/contract.prisma',
    output: './src/prisma',
    ...(connection === undefined ? {} : { db: { connection } }),
  }),
});
