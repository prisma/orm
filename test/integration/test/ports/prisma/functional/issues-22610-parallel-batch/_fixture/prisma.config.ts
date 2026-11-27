import { defineConfig as ormConfig, postgres18, postgresDriver } from '@internal/postgres/config';
import { definePrismaConfig } from '@prisma/cli-engine';

export default definePrismaConfig({
  orm: ormConfig({
    contract: {
      path: './contract.prisma',
      requiredCapabilities: [...postgres18, ...postgresDriver],
    },
    output: 'generated',
  }),
});
