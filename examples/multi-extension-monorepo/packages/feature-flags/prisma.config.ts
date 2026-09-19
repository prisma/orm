/**
 * Prisma 8 config for the internal `feature-flags` contract-space
 * package — see `../audit/prisma.config.ts` for the framing.
 */

import { defineConfig } from '@prisma/cli-engine';
import { defineConfig as ormConfig } from '@prisma/orm-postgres/config';

export default defineConfig({
  orm: ormConfig({
    contract: './src/contract.prisma',
    migrations: { dir: 'migrations' },
  }),
});
