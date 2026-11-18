import { APP_SPACE_ID, type MigrationRunnerFailure } from '@internal/framework-components/control';
import { ifDefined } from '@internal/utils/defined';
import { docsUrlFor } from '@internal/utils/structured-error';
import { ActionableCliError, type CliStructuredError } from './cli-errors';
import { adviceText, type RunnerAdvice } from './runner-advice';

/** The runner's why, naming the contract space the apply stopped in when it is not the application's own. */
function whyNamingSpace(failure: MigrationRunnerFailure): string | undefined {
  const { failingSpace } = failure.meta;
  if (failingSpace === undefined || failingSpace === APP_SPACE_ID) return failure.why;
  const stopped = `The apply stopped in contract space "${failingSpace}".`;
  return failure.why === undefined ? stopped : `${failure.why} ${stopped}`;
}

/**
 * A runner failure as the CLI reports it: the runner's code, message, why and meta, and the failure
 * itself as `cause`, with the CLI's advice: each way out as a next action, and all of them as `fix`
 * prose. When the apply stopped in a space other than the application's, the why names it.
 */
export function runnerFailureError(
  failure: MigrationRunnerFailure,
  advice: RunnerAdvice,
): CliStructuredError {
  return new ActionableCliError(failure.code, failure.message, {
    ...ifDefined('why', whyNamingSpace(failure)),
    fix: adviceText(advice),
    nextActions: advice,
    meta: failure.meta,
    docsUrl: docsUrlFor(failure.code),
    cause: failure,
  });
}
