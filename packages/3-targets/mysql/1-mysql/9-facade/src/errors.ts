import type { StructuredError, StructuredErrorOptions } from '@internal/utils/structured-error';
import { structuredError } from '@internal/utils/structured-error';

export type MysqlClientErrorCode =
  | 'RUNTIME.ARGUMENT_INVALID'
  | 'RUNTIME.BINDING_MISSING'
  | 'DRIVER.NOT_CONNECTED'
  | 'DRIVER.ALREADY_CONNECTED';

export function mysqlClientError(
  code: MysqlClientErrorCode,
  message: string,
  options?: StructuredErrorOptions,
): StructuredError {
  return structuredError(code, message, options);
}

/** A TypeScript contract path given to `createMysqlDefineConfig`'s `defineConfig`. */
export function typescriptContractUnsupported(targetId: string, contract: string): StructuredError {
  return structuredError(
    'CONFIG.VALIDATION_FAILED',
    `defineConfig for target "${targetId}" cannot build a contract from "${contract}", which is a TypeScript contract.`,
    {
      why: `Target "${targetId}" builds contracts from Prisma schemas and does not support TypeScript contracts.`,
      fix: 'Point `contract` at a Prisma schema: a .prisma file, a folder of them, or a glob.',
      meta: { contract },
    },
  );
}
