import type { StructuredError, StructuredErrorOptions } from '@internal/utils/structured-error';
import { structuredError } from '@internal/utils/structured-error';

type ContractCode = `CONTRACT.${ContractSubcode}`;

type ContractSubcode =
  | 'ARGUMENT_INVALID'
  | 'PACK_CONTRIBUTION_INVALID'
  | 'SQL_EXPRESSION_INTERPOLATION'
  | 'SQL_EXPRESSION_INVALID'
  | 'TABLE_AMBIGUOUS'
  | 'VALIDATION_FAILED';

export function contractError(
  code: ContractCode,
  message: string,
  options?: StructuredErrorOptions,
): StructuredError {
  return structuredError(code, message, options);
}
