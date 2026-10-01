import type { StructuredError, StructuredErrorOptions } from '@internal/utils/structured-error';
import { structuredError } from '@internal/utils/structured-error';

type ContractCode = `CONTRACT.${ContractSubcode}`;

type ContractSubcode =
  | 'ARGUMENT_INVALID'
  | 'HINT_INVALID'
  | 'PACK_CONTRIBUTION_INVALID'
  | 'TABLE_AMBIGUOUS'
  | 'VALIDATION_FAILED';

export function contractError(
  code: ContractCode,
  message: string,
  options?: StructuredErrorOptions,
): StructuredError {
  return structuredError(code, message, options);
}
