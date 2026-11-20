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

/** A TypeScript contract the config names in a file other than `.ts`, such as `.mts`. */
export function typescriptContractNotTs(targetId: string, contract: string): StructuredError {
  return structuredError(
    'CONFIG.VALIDATION_FAILED',
    `The config for target "${targetId}" cannot read the contract "${contract}".`,
    {
      why: 'A TypeScript contract must be a .ts file.',
      fix: 'Rename the contract to a .ts file, or point `contract` at a Prisma schema: a .prisma file, a folder of them, or a glob.',
      meta: { contract },
    },
  );
}
