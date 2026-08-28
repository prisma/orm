import { defineConfig as ormConfig } from '@internal/mongo/config';
import { defineConfig } from '@prisma/cli-engine';

export default defineConfig({
  orm: ormConfig({
    contract: './schema.prisma',
    output: 'generated',
  }),
});
