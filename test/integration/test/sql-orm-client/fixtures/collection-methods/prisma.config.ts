import pgvector from '@internal/extension-pgvector/control';
import { defineConfig as ormConfig } from '@internal/postgres/config';
import { definePrismaConfig } from '@prisma/cli-engine';
import { packageCopiedConfig } from '../package-copied-config';

export default definePrismaConfig({
  orm: packageCopiedConfig(
    ormConfig({
      contract: './contract.prisma',
      output: 'generated',
      extensions: [pgvector],
    }),
  ),
});
