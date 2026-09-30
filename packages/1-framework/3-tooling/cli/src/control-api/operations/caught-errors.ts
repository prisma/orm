/**
 * Classifies errors caught around migration-tools calls so commands never import the MigrationToolsError class directly.
 */

import { ifDefined } from '@internal/utils/defined';
import { isStructuredError } from '@internal/utils/structured-error';
import { CliStructuredError } from '../../utils/cli-errors';

/** CliStructuredError (including MigrationToolsError) → identity; anything else → null (caller rethrows/wraps). */
export function mapCaughtMigrationError(error: unknown): CliStructuredError | null {
  if (CliStructuredError.is(error)) {
    return error;
  }
  return null;
}

/** A structured error about the contract, such as a default a planner refuses → the same error as a CliStructuredError; anything else → null. */
export function mapCaughtContractError(error: unknown): CliStructuredError | null {
  if (!isStructuredError(error) || !error.code.startsWith('CONTRACT.')) {
    return null;
  }
  return new CliStructuredError(error.code, error.message, {
    ...ifDefined('why', error.why),
    ...ifDefined('fix', error.fix),
    ...ifDefined('where', error.where),
    ...ifDefined('meta', error.meta),
    cause: error,
  });
}
