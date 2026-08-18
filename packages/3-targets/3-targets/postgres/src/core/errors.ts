import { CliStructuredError } from '@internal/errors/control';
import type { StructuredError, StructuredErrorOptions } from '@internal/utils/structured-error';
import { structuredError } from '@internal/utils/structured-error';

export type PostgresTargetErrorCode =
  | 'CONTRACT.CODEC_DESCRIPTOR_MISSING'
  | 'CONTRACT.DEFAULT_INVALID'
  | 'CONTRACT.ENTITY_KIND_INVALID'
  | 'CONTRACT.IDENTIFIER_INVALID'
  | 'CONTRACT.INDEX_INVALID'
  | 'CONTRACT.INFER_UNSUPPORTED'
  | 'CONTRACT.MODEL_UNKNOWN'
  | 'CONTRACT.NAME_DUPLICATE'
  | 'CONTRACT.NATIVE_TYPE_INVALID'
  | 'CONTRACT.PACK_CONTRIBUTION_INVALID'
  | 'CONTRACT.POLICY_INVALID'
  | 'CONTRACT.ROLE_INVALID'
  | 'MIGRATION.CONTRACT_SPACE_VIOLATION'
  | 'MIGRATION.POSTGRES_CONTROL_STACK_MISSING'
  | 'MIGRATION.TARGET_MISMATCH'
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

/**
 * A Temporal-backed codec was invoked in a runtime with no `Temporal` implementation.
 *
 * Raised lazily, at the moment a value is encoded or decoded, never while assembling descriptors or
 * validating a contract — a client whose contract uses only the `*-string` codecs has to construct
 * and run in a runtime that has never heard of Temporal.
 *
 * `structuredError` rather than a plain `Error` so the generic decode path forwards it with this
 * code intact instead of re-wrapping it as `RUNTIME.DECODE_FAILED`, which would bury the one thing
 * the caller needs to act on.
 */
export function errorTemporalUnavailable(codecId: string, operation: string): StructuredError {
  return postgresError(
    'RUNTIME.TEMPORAL_UNAVAILABLE',
    `Codec '${codecId}' cannot ${operation} a value because this runtime has no global Temporal implementation.`,
    {
      why: 'Temporal-backed codecs read and write their values through the global Temporal API, which this runtime does not provide.',
      fix: "Run on a runtime with Temporal available, install a Temporal polyfill before creating the client, or author the column with its *String type to read and write PostgreSQL's own text instead.",
      meta: { codecId, operation },
    },
  );
}

/**
 * A mutation default generator that produces a `Temporal.*` value was invoked in a runtime with no
 * `Temporal` implementation.
 *
 * The same code as {@link errorTemporalUnavailable} and the same lazy timing, but a generator is
 * not a codec: it is reached because a column carries `temporal.createdAt()` or
 * `temporal.updatedAt()`, so the fix names the `*String` presets rather than a `*String` type.
 */
export function errorTemporalUnavailableForDefault(generatorId: string): StructuredError {
  return postgresError(
    'RUNTIME.TEMPORAL_UNAVAILABLE',
    `Mutation default generator '${generatorId}' cannot produce a value because this runtime has no global Temporal implementation.`,
    {
      why: 'The generator answers a Temporal-backed column, so the value it produces is a Temporal.Instant, which this runtime cannot construct.',
      fix: "Run on a runtime with Temporal available, install a Temporal polyfill before creating the client, or author the column with `temporal.createdAtString()` / `temporal.updatedAtString()` to store PostgreSQL's own text instead.",
      meta: { generatorId },
    },
  );
}

/**
 * A value crossed the boundary of what a `Temporal.*` type can represent.
 *
 * Both directions raise it: PostgreSQL text that Temporal cannot parse (`infinity`, a `DateStyle`
 * the server renders non-ISO, a year beyond Temporal's range) and application values PostgreSQL
 * would not accept back. The message names the `*String` type that reads the same column as the
 * server's own text, because that type existing is the entire reason this is a recoverable
 * situation rather than a dead end.
 */
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
    `Codec '${codecId}' cannot represent the value ${direction}: ${JSON.stringify(value)} — ${detail}. Use ${stringType} to carry this column as PostgreSQL's own text.`,
    {
      why: `${detail}. Temporal is the authoritative parser and range check for this codec, so a value it cannot express has no representation on this column.`,
      fix: `Author the column as ${stringType} to read and write PostgreSQL's own text for it, which preserves every value the database accepts.`,
      meta: { codecId, operation, value, stringType },
      ...(options.cause === undefined ? {} : { cause: options.cause }),
    },
  );
}

/**
 * A write carried a non-ISO calendar. Rejected rather than silently discarded: PostgreSQL stores no
 * calendar, so accepting the value would quietly drop the one thing the author went out of their
 * way to specify.
 */
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
