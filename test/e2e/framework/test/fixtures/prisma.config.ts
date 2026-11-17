import { definePrismaConfig } from '@prisma/cli-engine';
import arktypeJson from '@prisma/orm-extension-arktype-json/control';
import pgvector from '@prisma/orm-extension-pgvector/control';
import { defineConfig as ormConfig } from '@prisma/orm-postgres/config';

export default definePrismaConfig({
  orm: ormConfig({
    contract: './contract.ts',
    output: './generated',
    extensions: [pgvector, arktypeJson],
  }),
});
