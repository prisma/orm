/**
 * Aggregate root config for the multi-extension-monorepo example.
 *
 * Composes the application's own contract with two internal extension
 * packages (`audit` and `feature-flags`). This is the config an
 * application author writes — the CLI reads it for `contract emit`,
 * `migration plan`, `db init`, and `db update`.
 */

import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig as ormConfig } from '@prisma/orm-postgres/config';
import audit from '../packages/audit/src/control';
import featureFlags from '../packages/feature-flags/src/control';

export default definePrismaConfig({
  orm: ormConfig({
    contract: './src/contract.prisma',
    extensions: [audit, featureFlags],
    migrations: { dir: 'migrations' },
  }),
});
