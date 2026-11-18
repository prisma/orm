import type { StructuredError, StructuredErrorOptions } from '@internal/utils/structured-error';
import { structuredError } from '@internal/utils/structured-error';

type SqlEmitterErrorCode =
  | 'CONTRACT.AGGREGATE_DESCRIPTOR_AMBIGUOUS'
  | 'CONTRACT.AGGREGATE_OUTPUT_CODEC_MISSING'
  | 'CONTRACT.NAMESPACE_INVALID'
  | 'CONTRACT.TYPE_UNKNOWN';

export function sqlEmitterError(
  code: SqlEmitterErrorCode,
  message: string,
  options?: StructuredErrorOptions,
): StructuredError {
  return structuredError(code, message, options);
}
