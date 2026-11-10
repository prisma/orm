import { defineConfig as ormConfig, prisma6Schema } from '@internal/mongo/config';
import { definePrismaConfig } from '@prisma/cli-engine';

export default definePrismaConfig({
  orm: ormConfig({
    contract: prisma6Schema('./schema.prisma'),
    output: 'generated',
  }),
});
