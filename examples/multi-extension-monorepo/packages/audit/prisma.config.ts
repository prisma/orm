/**
 * Prisma Next config for the internal `audit` contract-space package.
 *
 * Each "internal package" subdirectory is treated as a self-contained
 * "project" for the CLI: `prisma contract emit` writes
 * `<package>/src/contract.{json,d.ts}`; `prisma migration plan`
 * writes `<package>/migrations/<dirName>/...`. The descriptor at
 * `src/control.ts` then JSON-imports those artefacts.
 *
 * Follows the contract-space package layout convention.
 *
 * @see docs/architecture docs/adrs/ADR 212 - Contract spaces.md
 */

import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig as ormConfig } from '@prisma/orm-postgres/config';

export default definePrismaConfig({
  orm: ormConfig({
    contract: './src/contract.prisma',
    migrations: { dir: 'migrations' },
  }),
});
