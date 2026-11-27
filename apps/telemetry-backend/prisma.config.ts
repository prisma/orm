import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig as ormConfig, postgres18, postgresDriver } from '@prisma/orm-postgres/config';

function readRequiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} must be set`);
  }
  return value;
}

const databaseUrl = readRequiredEnv('DATABASE_URL');

export default definePrismaConfig({
  orm: ormConfig({
    contract: {
      path: './src/prisma/contract.prisma',
      requiredCapabilities: [...postgres18, ...postgresDriver],
    },
    db: {
      connection: databaseUrl,
    },
  }),
});
