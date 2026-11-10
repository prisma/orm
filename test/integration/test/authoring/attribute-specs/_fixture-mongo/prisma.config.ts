import { defineConfig as ormConfig } from '@internal/mongo/config';
import { definePrismaConfig } from '@prisma/cli-engine';

export default definePrismaConfig({
  orm: ormConfig({
    contract: './schema.prisma',
    output: 'generated',
  }),
});
