// The workspace name of `@prisma/orm-mongo/config`: every fixture in this
// app stays on one import root (ADR 242).
import { defineConfig as mongo } from '@internal/mongo/config';
import { definePrismaConfig } from '@prisma/cli-engine';

export default definePrismaConfig({
  orm: mongo({
    contract: './contract.prisma',
    output: 'output',
    db: {
      connection: '{{DB_URL}}',
    },
  }),
});
