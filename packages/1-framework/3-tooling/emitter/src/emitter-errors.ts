import type { StructuredError, StructuredErrorOptions } from '@internal/utils/structured-error';
import { structuredError } from '@internal/utils/structured-error';

export type EmitterErrorCode =
  | 'CONFIG.VALIDATION_FAILED'
  | 'CONTRACT.MODEL_BASE_MISSING'
  | 'CONTRACT.MODEL_RELATION_TARGET_MISSING'
  | 'CONTRACT.MODEL_TYPE_NAME_COLLISION'
  | 'CONTRACT.MODEL_TYPE_NAME_INVALID'
  | 'CONTRACT.MODEL_VARIANT_MISSING'
  | 'CONTRACT.NAMESPACE_INVALID'
  | 'CONTRACT.RELATION_INVALID';

export function emitterError(
  code: EmitterErrorCode,
  message: string,
  options?: StructuredErrorOptions,
): StructuredError {
  return structuredError(code, message, options);
}
