import arktypeJson from '@internal/extension-arktype-json/control';
import { defineConfig as ormConfig } from '@internal/postgres/config';
import { definePrismaConfig } from '@prisma/cli-engine';

export default definePrismaConfig({
  orm: ormConfig({
    contract: './contract.ts',
    output: 'generated',
    extensions: [arktypeJson],
  }),
});
