/**
 * Prisma Next config for the `extension-paradedb` package.
 *
 * The extension package is treated as a self-contained "project" for
 * the CLI: `prisma contract emit` writes
 * `<package>/src/contract.{json,d.ts}`; `prisma migration plan` writes
 * `<package>/migrations/<dirName>/...`. The descriptor at
 * `src/exports/control.ts` then JSON-imports those artefacts.
 *
 * Follows the contract-space package layout convention.
 *
 * @see docs/architecture docs/adrs/ADR 212 - Contract spaces.md
 */

import postgresAdapter from '@internal/adapter-postgres/control';
import { defineConfig as ormConfig } from '@internal/cli/config-types';
import sql from '@internal/family-sql/control';
import { emptyContract } from '@internal/sql-contract-ts/config-types';
import postgres from '@internal/target-postgres/control';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { definePrismaConfig } from '@prisma/cli-engine';

export default definePrismaConfig({
  orm: ormConfig({
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    // migrations-only contract space: installs pg_search via migrations, contributes no app-visible schema
    contract: emptyContract({
      output: 'src/contract.json',
      target: postgres,
      createNamespace: postgresCreateNamespace,
    }),
    migrations: {
      dir: 'migrations',
    },
  }),
});
