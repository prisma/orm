import { defineConfig as ormConfig, postgres18, postgresDriver } from '@internal/postgres/config';
import { definePrismaConfig } from '@prisma/cli-engine';
import { packageCopiedConfig } from '../package-copied-config';

export default definePrismaConfig({
  orm: packageCopiedConfig(
    ormConfig({
      contract: {
        path: './contract.prisma',
        requiredCapabilities: [...postgres18, ...postgresDriver],
      },
      output: 'generated',
    }),
  ),
});
