import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig as ormConfig } from '@prisma/orm-sqlite/config';

export default definePrismaConfig({
  orm: ormConfig({
    contract: './contract.ts',
    output: './generated',
  }),
});
