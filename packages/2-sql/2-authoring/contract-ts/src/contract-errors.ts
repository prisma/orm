import type { StructuredError, StructuredErrorOptions } from '@internal/utils/structured-error';
import { structuredError } from '@internal/utils/structured-error';

export type ContractCode = `CONTRACT.${ContractSubcode}`;

type ContractSubcode =
  | 'VALIDATION_FAILED'
  | 'NAME_DUPLICATE'
  | 'MODEL_UNKNOWN'
  | 'PACK_CONTRIBUTION_INVALID'
  | 'PACK_FAMILY_MISMATCH'
  | 'PACK_TARGET_MISMATCH'
  | 'PACK_REF_INVALID'
  | 'PACK_MISSING'
  | 'NAMESPACE_INVALID'
  | 'NAMESPACE_UNSUPPORTED'
  | 'NAMESPACE_UNKNOWN'
  | 'ARGUMENT_INVALID'
  | 'FOREIGN_KEY_INVALID'
  | 'RELATION_INVALID'
  | 'IDENTITY_INVALID'
  | 'CONSTRAINT_INVALID'
  | 'DEFAULT_INVALID'
  | 'DEFAULT_SQL_INTERPOLATION'
  | 'ENUM_INVALID'
  | 'CHECK_NAME_RESERVED'
  | 'CHECK_ON_STI_VARIANT'
  | 'CHECK_OPTOUT_INVALID'
  | 'TYPE_UNKNOWN'
  | 'FIELD_UNKNOWN'
  | 'MODEL_TOKEN_INVALID'
  | 'MODULE_EXPORT_MISSING'
  | 'ENTITY_KIND_UNKNOWN'
  | 'ENTITY_KIND_INVALID'
  | 'TABLE_MISMATCH';

export function contractError(
  code: ContractCode,
  message: string,
  options?: StructuredErrorOptions,
): StructuredError {
  return structuredError(code, message, options);
}
