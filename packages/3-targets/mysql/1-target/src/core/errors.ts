import { ifDefined } from '@internal/utils/defined';
import type { StructuredError, StructuredErrorOptions } from '@internal/utils/structured-error';
import { structuredError } from '@internal/utils/structured-error';

export type MysqlTargetErrorCode =
  | 'CONTRACT.ARGUMENT_INVALID'
  | 'CONTRACT.CONSTRAINT_INVALID'
  | 'CONTRACT.IDENTIFIER_INVALID'
  | 'CONTRACT.NAMESPACE_INVALID'
  | 'CONTRACT.TARGET_MISMATCH'
  | 'CONTRACT.TYPE_PARAMS_INVALID'
  | 'MIGRATION.CONTRACT_SPACE_VIOLATION'
  | 'MIGRATION.MARKER_LOCK_TIMEOUT'
  | 'MIGRATION.MYSQL_CONTROL_STACK_MISSING'
  | 'RUNTIME.AST_INVALID'
  | 'RUNTIME.AST_UNSUPPORTED'
  | 'RUNTIME.CHARACTER_SET_UNSUPPORTED'
  | 'RUNTIME.DECODE_FAILED'
  | 'RUNTIME.ENCODE_FAILED'
  | 'RUNTIME.SQL_MODE_UNSUPPORTED'
  | 'RUNTIME.TEMPORAL_UNAVAILABLE';

export function mysqlError(
  code: MysqlTargetErrorCode,
  message: string,
  options?: StructuredErrorOptions,
): StructuredError {
  return structuredError(code, message, options);
}

/** The refusal of a query a later slice of the MySQL target can render: `what` names the feature, as in `Lowering queries`. */
export function mysqlQueryNotYetSupported(what: string): StructuredError {
  return mysqlError('RUNTIME.AST_UNSUPPORTED', `${what} is not yet supported on MySQL.`, {
    why: 'The MySQL target renders reads; writes and some query forms are not built yet.',
    fix: 'Use a Postgres or SQLite target for this query until the MySQL target supports it.',
    meta: { target: 'mysql', feature: what },
  });
}

const TEMPORAL_UNAVAILABLE_FIX =
  'Run on a runtime with Temporal available, install a Temporal polyfill before creating the client, or write the column as a convenience type at its default, which needs no Temporal: `DateTime` reads a JavaScript `Date`, and `Date`, `Time` and `Duration` read ISO 8601 strings.';

export function errorTemporalUnavailable(codecId: string, operation: string): StructuredError {
  return mysqlError(
    'RUNTIME.TEMPORAL_UNAVAILABLE',
    `Codec '${codecId}' cannot ${operation} a value because this runtime has no global Temporal implementation.`,
    {
      why: 'Temporal-backed codecs read and write their values through the global Temporal API, which this runtime does not provide.',
      fix: TEMPORAL_UNAVAILABLE_FIX,
      meta: { codecId, operation },
    },
  );
}

export function errorTemporalUnavailableForDefault(generatorId: string): StructuredError {
  return mysqlError(
    'RUNTIME.TEMPORAL_UNAVAILABLE',
    `Mutation default generator '${generatorId}' cannot produce a value because this runtime has no global Temporal implementation.`,
    {
      why: 'The generator answers a Temporal-backed column, so the value it produces is a Temporal value, which this runtime cannot construct.',
      fix: TEMPORAL_UNAVAILABLE_FIX,
      meta: { generatorId },
    },
  );
}

export function errorTemporalWrongType(
  codecId: string,
  temporalTag: string,
  stringType: string,
  received: string,
): StructuredError {
  return mysqlError(
    'RUNTIME.ENCODE_FAILED',
    `Codec '${codecId}' encodes a ${temporalTag}, but received ${received}.`,
    {
      why: "The codec writes the Temporal value's own ISO 8601 text. A value of another type has no text the column holds.",
      fix: `Pass a ${temporalTag}, or author the column with its ${stringType} type to write ISO 8601 text.`,
      meta: { codecId, temporalTag, stringType, received },
    },
  );
}

export function errorTemporalNonIsoCalendar(codecId: string, calendarId: string): StructuredError {
  return mysqlError(
    'RUNTIME.ENCODE_FAILED',
    `Codec '${codecId}' accepts only the iso8601 calendar, but the value carries '${calendarId}'.`,
    {
      why: 'MySQL stores no calendar alongside a date, so a non-ISO calendar would be discarded on write and the value would read back as a different date than the one authored.',
      fix: 'Convert the value with .withCalendar("iso8601") before writing if the ISO projection is what you mean to store.',
      meta: { codecId, calendarId },
    },
  );
}

/** A date or time codec read a value from MySQL that is not a value of its type, such as a zero date or a `time` that is no time of day, or that `Temporal` cannot hold. */
export function errorDateTimeUnreadable(options: {
  readonly codecId: string;
  readonly value: string;
  readonly detail: string;
  readonly cause?: unknown;
}): StructuredError {
  const { codecId, value, detail } = options;
  return mysqlError(
    'RUNTIME.DECODE_FAILED',
    `Codec '${codecId}' cannot read the value MySQL returned: ${JSON.stringify(value)}. ${detail}`,
    {
      why: "MySQL can hold values the column's type does not, such as the zero date 0000-00-00 or a time of 838:59:59, when a row is written outside Prisma.",
      fix: 'Rewrite the row with a value the column type holds, or read the column with a type that holds its text, such as String.',
      meta: { codecId, value: value.slice(0, 100) },
      ...ifDefined('cause', options.cause),
    },
  );
}

/** A date or time codec was given a value its column does not hold, such as a date before the year 1000 or text with digits below a microsecond. */
export function errorDateTimeUnwritable(options: {
  readonly codecId: string;
  readonly received: string;
  readonly detail: string;
  readonly cause?: unknown;
}): StructuredError {
  const { codecId, received, detail } = options;
  return mysqlError(
    'RUNTIME.ENCODE_FAILED',
    `Codec '${codecId}' cannot write ${received}. ${detail}`,
    {
      why: 'The codec refuses a value its column does not hold before it reaches MySQL.',
      fix: 'Write a value the column holds, as the message shows.',
      meta: { codecId, received: received.slice(0, 100) },
      ...ifDefined('cause', options.cause),
    },
  );
}
