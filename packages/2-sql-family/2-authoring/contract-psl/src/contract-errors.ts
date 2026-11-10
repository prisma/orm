import type { StructuredError, StructuredErrorOptions } from '@internal/utils/structured-error';
import { structuredError } from '@internal/utils/structured-error';

type ContractCode = `CONTRACT.${ContractSubcode}`;

type ContractSubcode = 'PACK_CONTRIBUTION_INVALID';

export function contractError(
  code: ContractCode,
  message: string,
  options?: StructuredErrorOptions,
): StructuredError {
  return structuredError(code, message, options);
}
