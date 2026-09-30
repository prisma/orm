import { ifDefined } from '@internal/utils/defined';
import { isInternalError } from '@internal/utils/internal-error';
import { type Diagnostic, isStructuredError } from '@internal/utils/structured-error';
import { CliStructuredError, errorUnexpected } from '../../utils/cli-errors';
import {
  metaWithoutConnectionString,
  nextActionWithoutConnectionString,
  sanitizeErrorMessage,
} from '../../utils/command-helpers';

/**
 * The error a command reports for one it caught. A CLI error is reported as it is, and so is any other error a library raised with a structured code, such as `CONTRACT.DEFAULT_INVALID` for a stale contract's default or `RUNTIME.TYPE_PARAMS_INVALID` for its type parameters: the code says what went wrong better than the command can. An `InternalError` is thrown again, so the command boundary, `defineOrmCommand`, lets the engine report it as a bug. Anything else is reported as `CLI.UNEXPECTED` with the `why` the command gives for the error's message, and a `code` it carries that is not a structured one, such as a driver's `ECONNREFUSED` or a SQLSTATE, in `meta.code`.
 *
 * A command that holds a database connection passes its connection string, which is then removed from every string the reported error carries, whichever of those it is.
 */
export function errorFromCaught(
  error: unknown,
  why: (message: string) => string,
  options: { readonly connection?: string | undefined } = {},
): CliStructuredError {
  const reported = reportedError(error, why);
  return options.connection === undefined
    ? reported
    : withoutConnectionString(reported, options.connection);
}

function reportedError(error: unknown, why: (message: string) => string): CliStructuredError {
  if (isInternalError(error)) {
    throw error;
  }
  if (CliStructuredError.is(error)) {
    return error;
  }
  if (isStructuredError(error)) {
    return new CliStructuredError(error.code, error.message, {
      ...ifDefined('severity', error.severity),
      ...ifDefined('why', error.why),
      ...ifDefined('fix', error.fix),
      ...ifDefined('nextActions', error.nextActions),
      ...ifDefined('where', error.where),
      ...ifDefined('meta', error.meta),
      ...ifDefined('docsUrl', error.docsUrl),
      cause: error,
    });
  }
  const message = error instanceof Error ? error.message : String(error);
  const driverCode = error instanceof Error ? Reflect.get(error, 'code') : undefined;
  return errorUnexpected(message, {
    why: why(message),
    ...ifDefined('meta', typeof driverCode === 'string' ? { code: driverCode } : undefined),
    cause: error,
  });
}

function withoutConnectionString(
  error: CliStructuredError,
  connection: string,
): CliStructuredError {
  const clean = (text: string): string => sanitizeErrorMessage(text, connection);
  return new CliStructuredError(error.code, clean(error.message), {
    severity: error.severity,
    ...ifDefined('why', error.why === undefined ? undefined : clean(error.why)),
    ...ifDefined('fix', error.fix === undefined ? undefined : clean(error.fix)),
    ...ifDefined(
      'nextActions',
      error.nextActions?.map((action) => nextActionWithoutConnectionString(action, connection)),
    ),
    ...ifDefined(
      'diagnostics',
      error.diagnostics?.map((diagnostic) =>
        diagnosticWithoutConnectionString(diagnostic, connection),
      ),
    ),
    ...ifDefined('where', error.where),
    ...ifDefined(
      'meta',
      error.meta === undefined ? undefined : metaWithoutConnectionString(error.meta, connection),
    ),
    ...ifDefined('docsUrl', error.docsUrl),
    cause: error.cause,
  });
}

function diagnosticWithoutConnectionString(diagnostic: Diagnostic, connection: string): Diagnostic {
  const clean = (text: string): string => sanitizeErrorMessage(text, connection);
  return {
    ...diagnostic,
    summary: clean(diagnostic.summary),
    ...ifDefined('why', diagnostic.why === undefined ? undefined : clean(diagnostic.why)),
    nextActions: diagnostic.nextActions.map((action) =>
      nextActionWithoutConnectionString(action, connection),
    ),
    ...ifDefined(
      'meta',
      diagnostic.meta === undefined
        ? undefined
        : metaWithoutConnectionString(diagnostic.meta, connection),
    ),
  };
}
