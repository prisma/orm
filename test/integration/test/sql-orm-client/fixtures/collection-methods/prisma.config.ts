import pgvector from '@internal/extension-pgvector/control';
import { defineConfig as ormConfig } from '@internal/postgres/config';
import { definePrismaConfig } from '@prisma/cli-engine';

export default definePrismaConfig({
  orm: ormConfig({
    contract: './contract.prisma',
    output: 'generated',
    extensions: [pgvector],
  }),
});
