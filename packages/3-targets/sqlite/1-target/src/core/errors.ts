import { CliStructuredError } from '@internal/errors/control';
import { ifDefined } from '@internal/utils/defined';
import type { StructuredError, StructuredErrorOptions } from '@internal/utils/structured-error';
import { structuredError } from '@internal/utils/structured-error';

export type SqliteTargetErrorCode =
  | 'CONTRACT.ARGUMENT_INVALID'
  | 'CONTRACT.CONSTRAINT_INVALID'
  | 'CONTRACT.DEFAULT_INVALID'
  | 'CONTRACT.IDENTIFIER_INVALID'
  | 'CONTRACT.NAMESPACE_INVALID'
  | 'CONTRACT.TARGET_MISMATCH'
  | 'CONTRACT.TYPE_UNKNOWN'
  | 'MIGRATION.CONTRACT_SPACE_VIOLATION'
  | 'MIGRATION.COPY_EXPRESSION_COLUMN_UNKNOWN'
  | 'MIGRATION.SQLITE_CONTROL_STACK_MISSING'
  | 'MIGRATION.SQL_EXPRESSION_INVALID'
  | 'MIGRATION.TARGET_MISMATCH'
  | 'MIGRATION.TEMPORARY_VALUE_INVALID'
  | 'RUNTIME.DECODE_FAILED'
  | 'RUNTIME.ENCODE_FAILED'
  | 'RUNTIME.TEMPORAL_UNAVAILABLE';

export function sqliteError(
  code: SqliteTargetErrorCode,
  message: string,
  options?: StructuredErrorOptions,
): StructuredError {
  return structuredError(code, message, options);
}

/**
 * A `SqliteMigration` operation that needs the materialized control adapter
 * — named by `operation` (e.g. `createTable`, `dropColumn`, `recreateTable`) —
 * was invoked, but the migration was constructed without a `ControlStack`.
 * Concrete authoring usage always goes through the migration CLI entrypoint,
 * which assembles a stack from the loaded `prisma.config.ts`; reaching this
 * error means a test fixture or ad-hoc consumer instantiated `SqliteMigration`
 * with the no-arg form (legal for `operations` / `describe` introspection only).
 *
 * The `operation` argument is required so every throw site names the operation
 * that actually failed; a new operation cannot inherit a misattributed message.
 *
 * Distinct from `MIGRATION.UNFILLED_PLACEHOLDER` (placeholder not filled)
 * because the missing input is the stack itself, not the per-operation
 * contract.
 *
 * Lives in `@internal/target-sqlite/errors` rather than the shared
 * framework migration errors module because the failure is target-specific:
 * the contract it talks about (`SqliteMigration`, the SQLite control
 * adapter, the SQLite-target stack) only exists in this package.
 */
export function errorSqliteMigrationStackMissing(operation: string): CliStructuredError {
  return new CliStructuredError(
    'MIGRATION.SQLITE_CONTROL_STACK_MISSING',
    `SqliteMigration.${operation} requires a control adapter`,
    {
      why: `SqliteMigration.${operation} was invoked on an instance constructed without a ControlStack, so the stored controlAdapter is undefined and the operation cannot lower its DDL node.`,
      fix: 'Construct the migration via the migration CLI entrypoint (which assembles a ControlStack from the loaded prisma.config.ts), or pass a ControlStack containing a SQLite adapter to the migration constructor in test fixtures.',
      meta: { operation },
    },
  );
}

const TEMPORAL_UNAVAILABLE_FIX =
  'Run on a runtime with Temporal available, install a Temporal polyfill before creating the client, or write the column as a convenience type at its default, which needs no Temporal: `DateTime` reads a JavaScript `Date`, and `Date`, `Time` and `Duration` read ISO 8601 strings.';

export function errorTemporalUnavailable(codecId: string, operation: string): StructuredError {
  return sqliteError(
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
  return sqliteError(
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
  return sqliteError(
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
  return sqliteError(
    'RUNTIME.ENCODE_FAILED',
    `Codec '${codecId}' accepts only the iso8601 calendar, but the value carries '${calendarId}'.`,
    {
      why: 'SQLite stores no calendar alongside a date, so a non-ISO calendar would be discarded on write and the value would read back as a different date than the one authored.',
      fix: 'Convert the value with .withCalendar("iso8601") before writing if the ISO projection is what you mean to store.',
      meta: { codecId, calendarId },
    },
  );
}

/** A date or time codec read text from SQLite that is not a value of its type, or that `Temporal` cannot hold. */
export function errorDateTimeUnreadable(options: {
  readonly codecId: string;
  readonly value: string;
  readonly detail: string;
  readonly cause?: unknown;
}): StructuredError {
  const { codecId, value, detail } = options;
  return sqliteError(
    'RUNTIME.DECODE_FAILED',
    `Codec '${codecId}' cannot read the value SQLite returned: ${JSON.stringify(value)}. ${detail}`,
    {
      why: "SQLite stores dates and times as text and checks none of it, so a row written outside Prisma can hold text that is not a value of the column's type.",
      fix: 'Rewrite the row in the form the column stores, or read the column with a type that holds its text, such as String.',
      meta: { codecId, value: value.slice(0, 100) },
      ...ifDefined('cause', options.cause),
    },
  );
}

/** A date or time codec was given a value that names no value its type stores, such as text with a digit below a millisecond. */
export function errorDateTimeUnwritable(options: {
  readonly codecId: string;
  readonly received: string;
  readonly detail: string;
  readonly cause?: unknown;
}): StructuredError {
  const { codecId, received, detail } = options;
  return sqliteError(
    'RUNTIME.ENCODE_FAILED',
    `Codec '${codecId}' cannot write ${received}. ${detail}`,
    {
      why: 'SQLite stores dates and times as text in one form for each value, so the column sorts and compares by the text. A value that form cannot hold is refused rather than changed.',
      fix: 'Write a value the column holds, as the message shows.',
      meta: { codecId, received: received.slice(0, 100) },
      ...ifDefined('cause', options.cause),
    },
  );
}
