import { type StructuredError, structuredError } from '@internal/utils/structured-error';

/** A TypeScript contract given to MariaDB's `defineConfig`: only PSL contracts are built for MariaDB. */
export function typescriptContractUnsupported(contract: string): StructuredError {
  return structuredError(
    'CONFIG.VALIDATION_FAILED',
    `MariaDB's defineConfig reads only PSL contracts, and "${contract}" is a TypeScript contract.`,
    {
      why: 'TypeScript contracts are built for MySQL; MariaDB contracts are written in PSL.',
      fix: 'Write the contract as a .prisma schema and point `contract` at it.',
      meta: { contract },
    },
  );
}
