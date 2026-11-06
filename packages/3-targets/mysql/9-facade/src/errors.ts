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
