import type { StructuredError, StructuredErrorOptions } from '@internal/utils/structured-error';
import { structuredError } from '@internal/utils/structured-error';

export type MongoTargetErrorCode =
  | `MIGRATION.${MigrationSubcode}`
  | 'RUNTIME.DECODE_FAILED'
  | 'RUNTIME.ENCODE_FAILED'
  | 'RUNTIME.TEMPORAL_UNAVAILABLE';

type MigrationSubcode =
  | 'DATA_TRANSFORM_CHECK_NOT_READ_ONLY'
  | 'FIELD_NAME_UNSUPPORTED'
  | 'INVALID_OPERATION_ENTRY'
  | 'OPERATION_UNSUPPORTED';

/** The codes the Mongo migration runner returns a failure with. */
export type MongoMigrationRunnerErrorCode =
  | 'MIGRATION.EXECUTION_FAILED'
  | 'MIGRATION.MARKER_CAS_FAILURE'
  | 'MIGRATION.MARKER_ORIGIN_MISMATCH'
  | 'MIGRATION.POLICY_VIOLATION'
  | 'MIGRATION.POSTCHECK_FAILED'
  | 'MIGRATION.PRECHECK_FAILED'
  | 'MIGRATION.SCHEMA_VERIFY_FAILED';

export function mongoTargetError(
  code: MongoTargetErrorCode,
  message: string,
  options?: StructuredErrorOptions,
): StructuredError {
  return structuredError(code, message, options);
}
