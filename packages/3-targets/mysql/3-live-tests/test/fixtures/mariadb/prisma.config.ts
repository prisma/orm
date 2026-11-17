import { defineConfig as ormConfig } from '@internal/mariadb/config';
import { definePrismaConfig } from '@prisma/cli-engine';

export default definePrismaConfig({
  orm: ormConfig({
    contract: '../contract.prisma',
    output: 'generated',
  }),
});
