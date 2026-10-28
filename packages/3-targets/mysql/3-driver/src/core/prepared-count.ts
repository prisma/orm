import { structuredError } from '@internal/utils/structured-error';

function hasParameters(value: object): value is { readonly parameters: readonly unknown[] } {
  return 'parameters' in value && Array.isArray(value.parameters);
}

/** The number of placeholders MySQL reported when it prepared a statement. mysql2 carries them as `parameters` on the statement, which the promise API wraps as `statement`; its typings leave both out. */
function preparedParameterCount(prepared: object): number {
  if (hasParameters(prepared)) return prepared.parameters.length;
  if (
    'statement' in prepared &&
    typeof prepared.statement === 'object' &&
    prepared.statement !== null
  ) {
    return hasParameters(prepared.statement) ? prepared.statement.parameters.length : 0;
  }
  return 0;
}

/**
 * Refuses a prepared statement for which MySQL reads a different number of placeholders than there are values. The driver's lexer and MySQL agree on the driver's session settings; a session a statement changed, such as one that turned on `NO_BACKSLASH_ESCAPES`, can make them disagree, and mysql2 never compares the count itself: too few values fail with a malformed packet, too many bind garbage.
 */
export function assertPreparedCount(prepared: object, values: number): void {
  const count = preparedParameterCount(prepared);
  if (count === values) return;
  throw structuredError(
    'RUNTIME.PARAM_PLACEHOLDER_MISMATCH',
    `MySQL reads ${count} placeholder(s) in the statement, but it has ${values} value(s)`,
    {
      why: "MySQL and the driver read the statement's quoting differently, usually because a statement changed the session's sql_mode, such as turning on NO_BACKSLASH_ESCAPES or ANSI_QUOTES.",
      fix: 'Do not change sql_mode in a session Prisma uses, or write the values into raw SQL through interpolation.',
      meta: { prepared: count, params: values },
    },
  );
}
