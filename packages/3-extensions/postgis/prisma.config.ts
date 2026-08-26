/**
 * Prisma Next config for the `extension-postgis` package.
 *
 * The extension package is treated as a self-contained "project" for
 * the CLI: `prisma contract emit` writes
 * `<package>/src/contract.{json,d.ts}` (colocated with the
 * `src/contract.ts` source); `prisma migration plan` writes
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
import { typescriptContract } from '@internal/sql-contract-ts/config-types';
import postgres from '@internal/target-postgres/control';
import { definePrismaConfig } from '@prisma/cli-engine';
import { contract } from './src/contract';

export default definePrismaConfig({
  orm: ormConfig({
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    contract: typescriptContract(contract, 'src/contract.json'),
    migrations: {
      dir: 'migrations',
    },
  }),
});
