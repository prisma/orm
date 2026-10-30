import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig as ormConfig } from '@prisma/orm-mongo/config';

export default definePrismaConfig({
  orm: ormConfig({ contract: './src/contract.prisma', db: { connection: 'mongodb://localhost/app' } }),
});
