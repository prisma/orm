import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig as ormConfig } from '@prisma/orm-mongo/config';

export default definePrismaConfig({
  orm: ormConfig({
    contract: './src/contract.prisma',
    db: {
      connection: process.env['MONGODB_URL'] ?? 'mongodb://localhost:27017/mongo-demo',
    },
  }),
});
