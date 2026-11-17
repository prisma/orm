import { ifDefined } from '@internal/utils/defined';
import type { StructuredError } from '@internal/utils/structured-error';
import { mongoTargetError } from './mongo-target-errors';

const TEMPORAL_UNAVAILABLE_FIX =
  'Run on a runtime with Temporal available, install a Temporal polyfill before creating the client, or write the field as a convenience type at its default, which needs no Temporal: `DateTime` reads a JavaScript `Date`, and `Date`, `Time` and `Duration` read ISO 8601 strings.';

export function errorTemporalUnavailable(codecId: string, operation: string): StructuredError {
  return mongoTargetError(
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
  return mongoTargetError(
    'RUNTIME.TEMPORAL_UNAVAILABLE',
    `Mutation default generator '${generatorId}' cannot produce a value because this runtime has no global Temporal implementation.`,
    {
      why: 'The generator answers a Temporal-backed field, so the value it produces is a Temporal value, which this runtime cannot construct.',
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
  return mongoTargetError(
    'RUNTIME.ENCODE_FAILED',
    `Codec '${codecId}' encodes a ${temporalTag}, but received ${received}.`,
    {
      why: 'The codec writes the value a Temporal value names. A value of another type names none the field holds.',
      fix: `Pass a ${temporalTag}, or author the field with its ${stringType} type to write ISO 8601 text.`,
      meta: { codecId, temporalTag, stringType, received },
    },
  );
}

export function errorTemporalNonIsoCalendar(codecId: string, calendarId: string): StructuredError {
  return mongoTargetError(
    'RUNTIME.ENCODE_FAILED',
    `Codec '${codecId}' accepts only the iso8601 calendar, but the value carries '${calendarId}'.`,
    {
      why: 'MongoDB stores no calendar alongside a date, so a non-ISO calendar would be discarded on write and the value would read back as a different date than the one authored.',
      fix: 'Convert the value with .withCalendar("iso8601") before writing if the ISO projection is what you mean to store.',
      meta: { codecId, calendarId },
    },
  );
}

/** A date or time codec read a value from MongoDB that is not a value of its type, or that `Temporal` cannot hold. */
export function errorDateTimeUnreadable(options: {
  readonly codecId: string;
  readonly value: string;
  readonly detail: string;
  readonly cause?: unknown;
}): StructuredError {
  const { codecId, value, detail } = options;
  return mongoTargetError(
    'RUNTIME.DECODE_FAILED',
    `Codec '${codecId}' cannot read ${value}: ${detail}`,
    {
      why: 'MongoDB checks no form for a BSON date or string beyond its BSON type, so a document written outside Prisma can hold a value that is not a value of the field’s type.',
      fix: 'Rewrite the document in the form the field stores, or read the field with a type that holds what it stores, such as DateTime for a BSON date or String for a BSON string.',
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
  return mongoTargetError(
    'RUNTIME.ENCODE_FAILED',
    `Codec '${codecId}' cannot write ${received}. ${detail}`,
    {
      why: 'A BSON date holds milliseconds, a calendar date is stored at midnight UTC, and a time of day as a string with three fraction digits. A value that form cannot hold is refused rather than changed.',
      fix: 'Write a value the field holds, as the message shows.',
      meta: { codecId, received: received.slice(0, 100) },
      ...ifDefined('cause', options.cause),
    },
  );
}
