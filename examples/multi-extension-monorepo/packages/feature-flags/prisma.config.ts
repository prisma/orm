/**
 * Prisma Next config for the internal `feature-flags` contract-space
 * package — see `../audit/prisma.config.ts` for the framing.
 */

import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig as ormConfig } from '@prisma/orm-postgres/config';

export default definePrismaConfig({
  orm: ormConfig({
    contract: './src/contract.prisma',
    migrations: { dir: 'migrations' },
  }),
});
