import { ifDefined } from '@internal/utils/defined';
import type { MigrateFailure } from '../control-api/types';
import type { CliStructuredError } from './cli-errors';
import { errorPathUnreachable, errorRunnerFailed } from './cli-errors';

/** A `migrate` apply failure as the CLI's structured error. */
export function mapMigrateFailure(failure: MigrateFailure): CliStructuredError {
  if (failure.code === 'MIGRATION_PATH_NOT_FOUND') {
    return errorPathUnreachable(failure);
  }
  return errorRunnerFailed(failure.summary, {
    why: failure.why ?? 'Migration runner failed',
    fix: 'Fix the issue and re-run `{bin} db migrate --to <contract>` — previously applied migrations are preserved.',
    meta: failure.meta ?? {},
    ...ifDefined('cause', failure.cause),
  });
}
