import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig as ormConfig } from '@prisma/orm-mongo/config';

export default definePrismaConfig({
  orm: ormConfig({
    contract: './src/contract.prisma',
    db: {
      connection: process.env['DB_URL'] ?? 'mongodb://localhost:27017/retail-store',
    },
  }),
});
