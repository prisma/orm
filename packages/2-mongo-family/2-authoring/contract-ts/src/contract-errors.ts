import type { StructuredError, StructuredErrorOptions } from '@internal/utils/structured-error';
import { structuredError } from '@internal/utils/structured-error';

export type ContractCode = `CONTRACT.${ContractSubcode}`;

type ContractSubcode =
  | 'ARGUMENT_INVALID'
  | 'COLLECTION_INVALID'
  | 'DEFAULT_INVALID'
  | 'ENUM_INVALID'
  | 'ENUM_UNKNOWN'
  | 'FIELD_UNKNOWN'
  | 'INDEX_INVALID'
  | 'MODULE_EXPORT_MISSING'
  | 'NAME_DUPLICATE'
  | 'PACK_CONTRIBUTION_INVALID'
  | 'PACK_FAMILY_MISMATCH'
  | 'PACK_REF_INVALID'
  | 'PACK_TARGET_MISMATCH'
  | 'RELATION_INVALID';

export function contractError(
  code: ContractCode,
  message: string,
  options?: StructuredErrorOptions,
): StructuredError {
  return structuredError(code, message, options);
}
