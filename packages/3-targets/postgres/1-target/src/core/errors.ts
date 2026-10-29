import { CliStructuredError } from '@internal/errors/control';
import type { StructuredError, StructuredErrorOptions } from '@internal/utils/structured-error';
import { structuredError } from '@internal/utils/structured-error';

export type PostgresTargetErrorCode =
  | 'CONTRACT.ARGUMENT_INVALID'
  | 'CONTRACT.CODEC_DESCRIPTOR_MISSING'
  | 'CONTRACT.PRINT_UNSUPPORTED'
  | 'CONTRACT.DEFAULT_INVALID'
  | 'CONTRACT.ENTITY_KIND_INVALID'
  | 'CONTRACT.IDENTIFIER_INVALID'
  | 'CONTRACT.INDEX_INVALID'
  | 'CONTRACT.INFER_UNSUPPORTED'
  | 'CONTRACT.MODEL_UNKNOWN'
  | 'CONTRACT.NAME_DUPLICATE'
  | 'CONTRACT.PACK_CONTRIBUTION_INVALID'
  | 'CONTRACT.POLICY_INVALID'
  | 'CONTRACT.ROLE_INVALID'
  | 'MIGRATION.ALTER_COLUMN_TYPE_USING_WITHOUT_TYPE_CHANGE'
  | 'MIGRATION.COLUMN_TYPE_UNREADABLE'
  | 'MIGRATION.CONTRACT_SPACE_VIOLATION'
  | 'MIGRATION.POSTGRES_CONTROL_STACK_MISSING'
  | 'MIGRATION.SQL_EXPRESSION_INVALID'
  | 'MIGRATION.TARGET_MISMATCH'
  | 'RUNTIME.ARGUMENT_INVALID'
  | 'RUNTIME.DATE_STYLE_NOT_ISO'
  | 'RUNTIME.DECODE_FAILED'
  | 'RUNTIME.ENCODE_FAILED'
  | 'RUNTIME.TEMPORAL_UNAVAILABLE'
  | 'RUNTIME.TYPE_PARAMS_INVALID';

export function postgresError(
  code: PostgresTargetErrorCode,
  message: string,
  options?: StructuredErrorOptions,
): StructuredError {
  return structuredError(code, message, options);
}

/**
 * A `PostgresMigration` operation that needs the materialized control adapter
 * — named by `operation` (e.g. `createTable`, `dropColumn`, `dataTransform`) —
 * was invoked, but the migration was constructed without a `ControlStack`.
 * Concrete authoring usage always goes through the migration CLI entrypoint,
 * which assembles a stack from the loaded `prisma.config.ts`; reaching this
 * error means a test fixture or ad-hoc consumer instantiated `PostgresMigration`
 * with the no-arg form (legal for `operations` / `describe` introspection only).
 *
 * The `operation` argument is required so every throw site names the operation
 * that actually failed; a new operation cannot inherit a misattributed message.
 *
 * Distinct from `MIGRATION.UNFILLED_PLACEHOLDER` (placeholder not filled)
 * and `MIGRATION.DATA_TRANSFORM_CONTRACT_MISMATCH` (data-transform query
 * plan against wrong contract) because the missing input is the stack
 * itself, not the per-operation contract.
 *
 * Lives in `@internal/target-postgres/errors` rather than the shared
 * framework migration errors module because the failure is target-specific:
 * the contract it talks about (`PostgresMigration`, the Postgres control
 * adapter, the Postgres-target stack) only exists in this package.
 */
export function errorPostgresMigrationStackMissing(operation: string): CliStructuredError {
  return new CliStructuredError(
    'MIGRATION.POSTGRES_CONTROL_STACK_MISSING',
    `PostgresMigration.${operation} requires a control adapter`,
    {
      why: `PostgresMigration.${operation} was invoked on an instance constructed without a ControlStack, so the stored controlAdapter is undefined and the operation cannot lower its plan.`,
      fix: 'Construct the migration via the migration CLI entrypoint (which assembles a ControlStack from the loaded prisma.config.ts), or pass a ControlStack containing a Postgres adapter to the migration constructor in test fixtures.',
      meta: { operation },
    },
  );
}

const TEMPORAL_UNAVAILABLE_FIX =
  'Run on a runtime with Temporal available, install a Temporal polyfill before creating the client, or write the column as a convenience type at its default, which needs no Temporal: `DateTime` reads a JavaScript `Date`, and `Date`, `Time` and `Duration` read ISO 8601 strings.';

export function errorTemporalUnavailable(codecId: string, operation: string): StructuredError {
  return postgresError(
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
  return postgresError(
    'RUNTIME.TEMPORAL_UNAVAILABLE',
    `Mutation default generator '${generatorId}' cannot produce a value because this runtime has no global Temporal implementation.`,
    {
      why: 'The generator answers a Temporal-backed column, so the value it produces is a Temporal value, which this runtime cannot construct.',
      fix: TEMPORAL_UNAVAILABLE_FIX,
      meta: { generatorId },
    },
  );
}

export function errorTemporalUnrepresentable(options: {
  readonly codecId: string;
  readonly operation: 'decode' | 'encode';
  readonly stringType: string;
  readonly value: string;
  readonly detail: string;
  readonly cause?: unknown;
}): StructuredError {
  const { codecId, operation, stringType, value, detail } = options;
  const direction = operation === 'decode' ? 'PostgreSQL returned' : 'the application supplied';
  return postgresError(
    operation === 'decode' ? 'RUNTIME.DECODE_FAILED' : 'RUNTIME.ENCODE_FAILED',
    `Codec '${codecId}' cannot represent the value ${direction}: ${JSON.stringify(value)} — ${detail}. Use ${stringType} to carry this column as ISO 8601 text.`,
    {
      why: `${detail}. Temporal is the authoritative parser and range check for this codec, so a value it cannot express has no representation on this column.`,
      fix: `Author the column as ${stringType} to read and write it as ISO 8601 text, which holds every value the database accepts.`,
      meta: { codecId, operation, value, stringType },
      ...(options.cause === undefined ? {} : { cause: options.cause }),
    },
  );
}

export function errorTemporalWrongType(
  codecId: string,
  temporalTag: string,
  stringType: string,
  received: string,
): StructuredError {
  return postgresError(
    'RUNTIME.ENCODE_FAILED',
    `Codec '${codecId}' encodes a ${temporalTag}, but received ${received}.`,
    {
      why: "The codec serializes through the Temporal value's own toString(). A different type reaches PostgreSQL in a spelling it does not accept, and the resulting error names the column rather than the codec.",
      fix: `Pass a ${temporalTag}, or author the column with its ${stringType} type to write ISO 8601 text.`,
      meta: { codecId, temporalTag, stringType, received },
    },
  );
}

/** A date or time codec read text PostgreSQL printed under a DateStyle other than ISO, which no codec reads. */
export function errorDateStyleNotIso(codecId: string, received: string): StructuredError {
  return postgresError(
    'RUNTIME.DATE_STYLE_NOT_ISO',
    `Codec '${codecId}' read ${JSON.stringify(received)}, which PostgreSQL prints only when the connection's DateStyle is not ISO: the driver could not ensure the DateStyle=ISO the PostgreSQL target requires. Prisma reads dates and times only in DateStyle ISO.`,
    {
      why: 'PostgreSQL prints a date or timestamp in the DateStyle of the connection. The PostgreSQL driver ensures DateStyle=ISO on every connection it uses: it starts each connection it opens with it, and sets it on a connection the application supplies before first use. A statement that sets DateStyle on a connection undoes that, and so does a connection pooler between Prisma and PostgreSQL that drops the startup option or runs each statement on another server connection.',
      fix: "Do not change DateStyle on a connection Prisma uses. Behind a connection pooler, set DateStyle on the role or database (ALTER ROLE <role> SET DateStyle = 'ISO'), so every server connection holds it.",
      meta: { codecId, received: received.slice(0, 100) },
    },
  );
}

/** A string timestamp codec received something other than text, such as a `Date` from a contract emitted before its generator wrote text. */
export function errorTimestampTextWrongType(codecId: string, received: string): StructuredError {
  return postgresError(
    'RUNTIME.ENCODE_FAILED',
    `Codec '${codecId}' writes ISO 8601 text, but received ${received}.`,
    {
      why: "The codec sends its value to PostgreSQL unchanged. A Date would be sent in the process's local time zone, and a timestamp column without a time zone would store the wrong wall-clock time.",
      fix: 'Pass the timestamp as ISO 8601 text, such as "2024-01-02T03:04:05.678". If the value came from a generated default, emit the contract again: a contract emitted by an earlier version pairs this column with timestampNow, which generates a Date.',
      meta: { codecId, received },
    },
  );
}

export function errorTemporalNonIsoCalendar(codecId: string, calendarId: string): StructuredError {
  return postgresError(
    'RUNTIME.ENCODE_FAILED',
    `Codec '${codecId}' accepts only the iso8601 calendar, but the value carries '${calendarId}'.`,
    {
      why: 'PostgreSQL stores no calendar alongside a date, so a non-ISO calendar would be discarded on write and the value would read back as a different date than the one authored.',
      fix: 'Convert the value with .withCalendar("iso8601") before writing if the ISO projection is what you mean to store.',
      meta: { codecId, calendarId },
    },
  );
}
