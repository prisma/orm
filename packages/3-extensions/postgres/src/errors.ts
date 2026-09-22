import type { StructuredError, StructuredErrorOptions } from '@internal/utils/structured-error';
import { structuredError } from '@internal/utils/structured-error';

export type PostgresErrorCode =
  | 'CONTRACT.ENUM_INVALID'
  | 'CONTRACT.INDEX_INVALID'
  | 'CONTRACT.POLICY_INVALID'
  | 'RUNTIME.BINDING_INVALID'
  | 'RUNTIME.BINDING_MISSING'
  | 'DRIVER.NOT_CONNECTED'
  | 'DRIVER.ALREADY_CONNECTED';

export function postgresError(
  code: PostgresErrorCode,
  message: string,
  options?: StructuredErrorOptions,
): StructuredError {
  return structuredError(code, message, options);
}
