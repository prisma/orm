import { defineConfig as ormConfig } from '@internal/postgres/config';
import { defineConfig } from '@prisma/cli-engine';

export default defineConfig({
  orm: ormConfig({
    contract: './contract.prisma',
    output: 'generated',
  }),
});
