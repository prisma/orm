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

/** A contract path given to `createMysqlDefineConfig`'s `defineConfig` that is not a `.prisma` schema. */
export function prismaContractRequired(targetId: string, contract: string): StructuredError {
  return structuredError(
    'CONFIG.VALIDATION_FAILED',
    `defineConfig for target "${targetId}" cannot build a contract from "${contract}", which is not a .prisma schema.`,
    {
      why: 'This defineConfig builds the contract from a PSL schema, and a PSL schema is a file ending in .prisma.',
      fix: 'Point `contract` at a .prisma schema.',
      meta: { contract },
    },
  );
}
