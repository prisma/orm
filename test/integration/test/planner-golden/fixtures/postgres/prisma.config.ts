import pgvector from '@internal/extension-pgvector/control';
import postgis from '@internal/extension-postgis/control';
import { defineConfig as ormConfig } from '@internal/postgres/config';
import { definePrismaConfig } from '@prisma/cli-engine';

export default definePrismaConfig({
  orm: ormConfig({
    contract: './contract.ts',
    output: 'generated',
    extensions: [pgvector, postgis],
  }),
});
