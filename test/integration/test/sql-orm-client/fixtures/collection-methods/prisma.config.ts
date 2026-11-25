import pgvector from '@internal/extension-pgvector/control';
import { defineConfig as ormConfig } from '@internal/postgres/config';
import { definePrismaConfig } from '@prisma/cli-engine';
import { packageCopiedConfig } from '../package-copied-config';

export default definePrismaConfig({
  orm: packageCopiedConfig(
    ormConfig({
      contract: { path: './contract.prisma', version: 18 },
      output: 'generated',
      extensions: [pgvector],
    }),
  ),
});
