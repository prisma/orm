import { defineConfig as mongo } from '@internal/mongo/config';
import { definePrismaConfig } from '@prisma/cli-engine';

export default definePrismaConfig({
  orm: mongo({
    contract: './contract.prisma',
    output: 'output',
    db: {
      connection: '{{MONGO_URI}}',
    },
  }),
});
