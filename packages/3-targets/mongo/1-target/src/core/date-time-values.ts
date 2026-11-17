import { hasDigitsBelowAMillisecond, isValidDate } from '@internal/type-implementations/date';
import type { TemporalImplementation } from '@internal/type-implementations/temporal';
import {
  describeValue,
  type TemporalTag,
  type TemporalValue,
  temporalFromText,
  temporalToText,
} from '@internal/type-implementations/temporal-text';
import {
  errorDateTimeUnreadable,
  errorDateTimeUnwritable,
  errorTemporalNonIsoCalendar,
  errorTemporalWrongType,
} from './date-time-errors';
import { requireTemporal } from './require-temporal';

const MILLISECONDS_PER_DAY = 86_400_000;

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** The text a write stores for `value`, in the form `stored` writes; a value `stored` refuses is refused as `RUNTIME.ENCODE_FAILED`. */
export function storedTextForWrite(
  codecId: string,
  value: unknown,
  stored: (text: string) => string,
): string {
  if (typeof value !== 'string') {
    throw errorDateTimeUnwritable({
      codecId,
      received: describeValue(value),
      detail: 'It writes ISO 8601 text.',
    });
  }
  try {
    return stored(value);
  } catch (cause) {
    throw errorDateTimeUnwritable({
      codecId,
      received: JSON.stringify(value),
      detail: messageOf(cause),
      cause,
    });
  }
}

/** The stored form of a BSON string MongoDB returned, as `stored` reads it; text `stored` refuses is refused as `RUNTIME.DECODE_FAILED`. */
export function storedTextFromWire(
  codecId: string,
  wire: unknown,
  stored: (text: string) => string,
): string {
  if (typeof wire !== 'string') {
    throw errorDateTimeUnreadable({
      codecId,
      value: String(wire),
      detail: `MongoDB returned ${describeValue(wire)}, not a string.`,
    });
  }
  try {
    return stored(wire);
  } catch (cause) {
    throw errorDateTimeUnreadable({
      codecId,
      value: JSON.stringify(wire),
      detail: messageOf(cause),
      cause,
    });
  }
}

/** The BSON date MongoDB returned, as the `Date` the driver reads it as. */
export function dateFromWire(codecId: string, wire: unknown): Date {
  if (isValidDate(wire)) return wire;
  throw errorDateTimeUnreadable({
    codecId,
    value: String(wire),
    detail: `MongoDB returned ${describeValue(wire)}, not a BSON date.`,
  });
}

/** Whether `date` is at midnight UTC, the form a calendar date is stored in. */
export function isAtMidnightUtc(date: Date): boolean {
  return date.getTime() % MILLISECONDS_PER_DAY === 0;
}

/** The date part of `date` in UTC, as in `2024-02-29`, for a `Date` at midnight UTC. */
export function calendarDateTextOf(date: Date): string {
  const iso = date.toISOString();
  return iso.slice(0, iso.indexOf('T'));
}

/** The calendar date a BSON date at midnight UTC holds, as in `2024-02-29`. A BSON date at another time is refused, so a field written as an instant is never read as a date. */
export function calendarDateFromWire(codecId: string, wire: unknown): string {
  const date = dateFromWire(codecId, wire);
  if (isAtMidnightUtc(date)) return calendarDateTextOf(date);
  throw errorDateTimeUnreadable({
    codecId,
    value: date.toISOString(),
    detail:
      'a calendar date is stored as a BSON date at midnight UTC. A field that holds a time of day is a DateTime.',
  });
}

/** The BSON date at midnight UTC that stores the calendar date `text`, as in `2024-02-29`. */
export function midnightUtcOf(text: string): Date {
  return new Date(`${text}T00:00:00.000Z`);
}

/** A Temporal codec: its id, the Temporal kind it reads and writes, and the string type that holds its field as text. */
export interface TemporalCodecIdentity {
  readonly codecId: string;
  readonly temporalTag: TemporalTag;
  readonly stringType: string;
}

/** The Temporal value that stored text names, read with `parse`. */
export function temporalFromStoredText<T>(
  identity: TemporalCodecIdentity,
  text: string,
  parse: (temporal: TemporalImplementation, text: string) => T,
): T {
  const temporal = requireTemporal({ codecId: identity.codecId, operation: 'decode' });
  const read = temporalFromText(temporal, text, parse);
  if (read.kind === 'unreadable') {
    throw errorDateTimeUnreadable({
      codecId: identity.codecId,
      value: JSON.stringify(text),
      detail: `${identity.temporalTag} cannot hold it: ${read.detail}. Use ${identity.stringType} to read the field as text.`,
      cause: read.cause,
    });
  }
  return read.value;
}

/** The text a write stores for a Temporal value, in the form `stored` writes. A value of another kind, in a calendar other than ISO 8601, or with digits below a millisecond is refused. */
export function storedTextOfTemporal(
  identity: TemporalCodecIdentity,
  value: TemporalValue,
  stored: (text: string) => string,
): string {
  const encoded = temporalToText(value, identity.temporalTag);
  switch (encoded.kind) {
    case 'wrong-type':
      throw errorTemporalWrongType(
        identity.codecId,
        identity.temporalTag,
        identity.stringType,
        encoded.received,
      );
    case 'non-iso-calendar':
      throw errorTemporalNonIsoCalendar(identity.codecId, encoded.calendarId);
    case 'text':
      if (hasDigitsBelowAMillisecond(encoded.text)) {
        throw errorDateTimeUnwritable({
          codecId: identity.codecId,
          received: `the ${identity.temporalTag} ${encoded.text}`,
          detail:
            "It has digits below a millisecond, and the field holds milliseconds. Round it first, as in value.round({ smallestUnit: 'millisecond', roundingMode: 'trunc' }).",
        });
      }
      return storedTextForWrite(identity.codecId, encoded.text, stored);
  }
}
