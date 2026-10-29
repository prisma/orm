import { structuredError } from '@internal/utils/structured-error';

/** The number of placeholders MySQL reported when it prepared a statement. The `mariadb` package keeps it as `parameterCount` on the prepared statement; its typings leave it out. */
function preparedParameterCount(prepared: object): number {
  return 'parameterCount' in prepared && typeof prepared.parameterCount === 'number'
    ? prepared.parameterCount
    : 0;
}

/**
 * Refuses a prepared statement for which MySQL reads a different number of placeholders than there are values. The driver's lexer and MySQL agree on the driver's session settings; a session a statement changed, such as one that turned on `NO_BACKSLASH_ESCAPES`, can make them disagree. The package refuses too few values, but binds too many to the placeholders it has, in order, so a value would land in the wrong place.
 */
export function assertPlaceholderCount(prepared: object, values: number): void {
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
