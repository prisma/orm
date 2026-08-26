import 'dotenv/config';
import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig as ormConfig } from '@prisma/orm-sqlite/config';

export default definePrismaConfig({
  orm: ormConfig({
    contract: './prisma/contract.ts',
    output: './src/prisma',
    db: {
      connection: process.env['SQLITE_PATH'] ?? './demo.db',
    },
  }),
});
