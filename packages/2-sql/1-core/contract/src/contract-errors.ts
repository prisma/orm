import type { StructuredError, StructuredErrorOptions } from '@internal/utils/structured-error';
import { structuredError } from '@internal/utils/structured-error';

type ContractCode = `CONTRACT.${ContractSubcode}`;

type ContractSubcode =
  | 'ARGUMENT_INVALID'
  | 'CODEC_DESCRIPTOR_MISSING'
  | 'DATA_TYPE_UNREGISTERED'
  | 'INDEX_INVALID'
  | 'PACK_CONTRIBUTION_INVALID'
  | 'SQL_EXPRESSION_INTERPOLATION'
  | 'SQL_EXPRESSION_INVALID'
  | 'TABLE_AMBIGUOUS'
  | 'TYPE_PARAMS_INVALID'
  | 'VALIDATION_FAILED';

export function contractError(
  code: ContractCode,
  message: string,
  options?: StructuredErrorOptions,
): StructuredError {
  return structuredError(code, message, options);
}
