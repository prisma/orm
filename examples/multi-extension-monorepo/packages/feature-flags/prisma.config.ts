/**
 * Prisma 8 config for the internal `feature-flags` contract-space
 * package — see `../audit/prisma.config.ts` for the framing.
 */

import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig as ormConfig, postgres18, postgresDriver } from '@prisma/orm-postgres/config';

export default definePrismaConfig({
  orm: ormConfig({
    contract: {
      path: './src/contract.prisma',
      requiredCapabilities: [...postgres18, ...postgresDriver],
    },
    migrations: { dir: 'migrations' },
  }),
});
