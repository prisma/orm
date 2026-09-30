import type { StructuredError, StructuredErrorOptions } from '@internal/utils/structured-error';
import { structuredError } from '@internal/utils/structured-error';

type SqlFamilyErrorCode =
  | 'CONTRACT.PRINT_UNSUPPORTED'
  | 'CONTRACT.FOREIGN_KEY_INVALID'
  | 'CONTRACT.INFER_UNSUPPORTED'
  | 'CONTRACT.MARKER_ROW_CORRUPT'
  | 'CONTRACT.PACK_CONTRIBUTION_INVALID'
  | 'CONTRACT.TABLE_AMBIGUOUS'
  | 'CONTRACT.TYPE_UNKNOWN'
  | 'MIGRATION.MARKER_CAS_FAILURE';

export function sqlFamilyError(
  code: SqlFamilyErrorCode,
  message: string,
  options?: StructuredErrorOptions,
): StructuredError {
  return structuredError(code, message, options);
}
