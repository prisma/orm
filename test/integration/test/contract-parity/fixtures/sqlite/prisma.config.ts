import { defineConfig as ormConfig } from '@internal/sqlite/config';
import { definePrismaConfig } from '@prisma/cli-engine';

export default definePrismaConfig({
  orm: ormConfig({
    contract: './contract.ts',
    output: 'generated',
  }),
});
