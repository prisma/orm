import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig as ormConfig, postgres18, postgresDriver } from '@prisma/orm-postgres/config';

export default definePrismaConfig({
  orm: ormConfig({ contract: { path: './schema.prisma', requiredCapabilities: [...postgres18, ...postgresDriver] }, db: { connection: 'postgres://localhost/app' } }),
});
