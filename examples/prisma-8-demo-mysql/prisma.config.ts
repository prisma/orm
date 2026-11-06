import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig as ormConfig } from '@prisma/orm-mysql/config';

const connection = process.env['MYSQL_URL'];

export default definePrismaConfig({
  orm: ormConfig({
    contract: './prisma/contract.prisma',
    output: './src/prisma',
    ...(connection === undefined ? {} : { db: { connection } }),
  }),
});
