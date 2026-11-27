import { definePrismaConfig } from '@prisma/cli-engine';
import supabasePack from '@prisma/orm-extension-supabase/pack';
import { defineConfig as ormConfig, postgres18, postgresDriver } from '@prisma/orm-postgres/config';

export default definePrismaConfig({
  orm: ormConfig({
    contract: {
      path: './src/contract.prisma',
      requiredCapabilities: [...postgres18, ...postgresDriver],
    },
    extensions: [supabasePack],
    migrations: {
      dir: 'migrations',
    },
  }),
});
