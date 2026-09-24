import { definePrismaConfig } from '@prisma/cli-engine';
import supabasePack from '@prisma/orm-extension-supabase/pack';
import { defineConfig as ormConfig } from '@prisma/orm-postgres/config';

export default definePrismaConfig({
  orm: ormConfig({
    contract: './src/contract.prisma',
    extensions: [supabasePack],
    migrations: {
      dir: 'migrations',
    },
  }),
});
