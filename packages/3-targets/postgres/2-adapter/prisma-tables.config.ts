/**
 * Authoring config for the contract space of Prisma's own tables, which the Postgres target package
 * carries on its control descriptor. It lives here, not in the target package, because a config
 * names an adapter and this adapter already depends on the target. It writes into the target
 * package: `pnpm emit:prisma-tables` emits `../1-target/src/contract.{json,d.ts}`, and a
 * migration's `migration.ts` re-emits its `ops.json` and `migration.json` with
 * `pnpm exec tsx ../1-target/migrations/<dir>/migration.ts --config prisma-tables.config.ts`.
 */

import postgresAdapter from '@internal/adapter-postgres/control';
import { defineConfig as ormConfig } from '@internal/cli/config-types';
import sql from '@internal/family-sql/control';
import { prismaContract } from '@internal/sql-contract-psl/provider';
import postgres from '@internal/target-postgres/control';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { definePrismaConfig } from '@prisma/cli-engine';

export default definePrismaConfig({
  orm: ormConfig({
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    contract: {
      ...prismaContract('../1-target/src/contract.prisma', {
        output: '../1-target/src/contract.json',
        target: postgres,
        createNamespace: postgresCreateNamespace,
      }),
      typesModule: '#contract-types',
    },
    migrations: {
      dir: '../1-target/migrations',
      module: '@internal/target-postgres/migration',
    },
  }),
});
