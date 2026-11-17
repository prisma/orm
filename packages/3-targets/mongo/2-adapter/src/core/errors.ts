import type { StructuredError, StructuredErrorOptions } from '@internal/utils/structured-error';
import { structuredError } from '@internal/utils/structured-error';

export type MongoAdapterErrorCode = 'CONFIG.VALIDATION_FAILED' | 'CONTRACT.MARKER_ROW_CORRUPT';

export function mongoAdapterError(
  code: MongoAdapterErrorCode,
  message: string,
  options?: StructuredErrorOptions,
): StructuredError {
  return structuredError(code, message, options);
}

export function describeReceivedValue(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value !== 'object') return typeof value;
  return `object with keys [${Object.keys(value).join(', ')}]`;
}
