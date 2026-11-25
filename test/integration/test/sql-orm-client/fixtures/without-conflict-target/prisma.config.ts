import { defineConfig as ormConfig } from '@internal/postgres/config';
import { definePrismaConfig } from '@prisma/cli-engine';

export default definePrismaConfig({
  orm: ormConfig({
    contract: {
      path: './contract.prisma',
      version: 18,
      capabilities: [{ sql: { insertOnConflictTarget: false } }],
    },
    output: 'generated',
  }),
});
