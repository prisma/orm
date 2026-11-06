import { type StructuredError, structuredError } from '@internal/utils/structured-error';

/** A contract given to MariaDB's `defineConfig` that is not a `.prisma` schema: only PSL contracts are built for MariaDB. */
export function pslContractRequired(contract: string): StructuredError {
  return structuredError(
    'CONFIG.VALIDATION_FAILED',
    `MariaDB's defineConfig reads only .prisma contracts, and "${contract}" is not one.`,
    {
      why: 'TypeScript contracts are built for MySQL; MariaDB contracts are written in PSL.',
      fix: 'Write the contract as a .prisma schema and point `contract` at it.',
      meta: { contract },
    },
  );
}
