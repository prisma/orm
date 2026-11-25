import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig as ormConfig } from '@prisma/orm-postgres/config';

export default definePrismaConfig({
  orm: ormConfig({ contract: { path: './schema.prisma', databaseVersion: 18 }, db: { connection: 'postgres://localhost/app' } }),
});
