import { MigrationToolsError } from '@internal/migration-tools/errors';
import { notOk, type Result } from '@internal/utils/result';
import {
  CliStructuredError,
  errorContractValidationFailed,
  errorFileNotFound,
  errorSnapshotMissing,
  errorUnexpected,
} from '../../utils/cli-errors';
import { contractValidationMeta } from '../../utils/contract-validation-meta';

export function mapContractAtError(
  error: unknown,
  options?: { readonly artifactRole?: 'from' | 'to' },
): Result<never, CliStructuredError> {
  if (MigrationToolsError.is(error)) {
    switch (error.code) {
      case 'MIGRATION.REF_NOT_RESOLVABLE': {
        const refName =
          typeof error.meta?.['refName'] === 'string'
            ? error.meta['refName']
            : typeof error.meta?.['identifier'] === 'string'
              ? error.meta['identifier']
              : 'unknown';
        return notOk(errorSnapshotMissing(refName, { cause: error }));
      }
      case 'MIGRATION.CONTRACT_DESERIALIZATION_FAILED': {
        const filePath =
          typeof error.meta?.['filePath'] === 'string' ? error.meta['filePath'] : 'unknown';
        const message =
          typeof error.meta?.['message'] === 'string' ? error.meta['message'] : error.message;
        return notOk(
          errorContractValidationFailed(
            `Predecessor contract at ${filePath} failed to deserialize: ${message}`,
            { where: { path: filePath }, cause: error, meta: contractValidationMeta(error) },
          ),
        );
      }
      case 'MIGRATION.INVALID_JSON': {
        const filePath =
          typeof error.meta?.['filePath'] === 'string' ? error.meta['filePath'] : 'unknown';
        const message =
          typeof error.meta?.['parseError'] === 'string' ? error.meta['parseError'] : error.message;
        const role = options?.artifactRole ?? 'from';
        return notOk(
          errorContractValidationFailed(
            role === 'to'
              ? `Target contract at ${filePath} failed to deserialize: ${message}`
              : `Predecessor contract at ${filePath} failed to deserialize: ${message}`,
            { where: { path: filePath }, cause: error },
          ),
        );
      }
      case 'MIGRATION.BUNDLE_NOT_FOUND_FOR_GRAPH_NODE':
        return notOk(
          errorUnexpected(error.message, {
            why: error.why,
            fix: error.fix,
            cause: error,
          }),
        );
      case 'MIGRATION.CONTRACT_SNAPSHOT_MISSING': {
        const expectedPath =
          typeof error.meta?.['expectedPath'] === 'string'
            ? error.meta['expectedPath']
            : 'migrations/snapshots/';
        const role = options?.artifactRole ?? 'from';
        return notOk(
          errorFileNotFound(expectedPath, {
            why:
              role === 'to'
                ? `Target migration is missing its contract snapshot at ${expectedPath}`
                : `Predecessor migration is missing its contract snapshot at ${expectedPath}`,
            fix: 'Restore migrations/snapshots/ from version control, or re-run the command that produced this migration to regenerate its snapshot.',
            cause: error,
          }),
        );
      }
      default:
        return notOk(error);
    }
  }
  if (CliStructuredError.is(error)) {
    return notOk(error);
  }
  throw error;
}
