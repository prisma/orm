import {
  type DataTypeParams,
  dateTimeStoredText,
  refuseJsonValue,
} from '@internal/framework-components/codec';
import { hasDigitsBelow, isValidDate } from '@internal/type-implementations/date';
import type { TemporalImplementation } from '@internal/type-implementations/temporal';
import {
  describeValue,
  type TemporalTag,
  type TemporalValue,
  temporalFromText,
  temporalToText,
  withoutUtcDesignator,
} from '@internal/type-implementations/temporal-text';
import {
  errorDateTimeUnreadable,
  errorDateTimeUnwritable,
  errorTemporalNonIsoCalendar,
  errorTemporalWrongType,
  mysqlError,
} from './errors';
import { requireTemporal } from './require-temporal';

/** Reads text as a value of the column's type and returns its stored form, or throws when the type does not hold it. */
export type StoredText = (text: string) => string;

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** The text MySQL reads for a stored date and time, `2024-01-02 03:04:05.5`. */
export function mysqlWireText(stored: string): string {
  return stored.replace('T', ' ');
}

/** The UTC date and time without an offset that ISO 8601 text with a UTC offset names, in the form `stored` writes. Throws when the text names no instant, or one `stored` refuses. */
export function utcDateTimeOfInstantText(
  codecId: string,
  text: string,
  stored: StoredText,
): string {
  const instant = dateTimeStoredText(text, { shape: 'instant', ownerId: codecId });
  return stored(withoutUtcDesignator(instant));
}

/** The stored form `stored` writes for a value an application wrote; a value it refuses is refused as `RUNTIME.ENCODE_FAILED`. */
export function storedTextForWrite(codecId: string, value: unknown, stored: StoredText): string {
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

/** The stored form of the text MySQL returned for a row, as `stored` reads it; text `stored` refuses is refused as `RUNTIME.DECODE_FAILED`. */
export function storedTextFromWire(codecId: string, wire: unknown, stored: StoredText): string {
  if (typeof wire !== 'string') {
    throw errorDateTimeUnreadable({
      codecId,
      value: String(wire),
      detail: `MySQL returned ${describeValue(wire)}, not text.`,
    });
  }
  try {
    return stored(wire);
  } catch (cause) {
    throw errorDateTimeUnreadable({ codecId, value: wire, detail: messageOf(cause), cause });
  }
}

/** A Temporal codec: its id, the Temporal kind it reads and writes, and the string type that holds its column as text. */
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
      value: text,
      detail: `${identity.temporalTag} cannot hold it: ${read.detail}. Use ${identity.stringType} to read the column as text.`,
      cause: read.cause,
    });
  }
  return read.value;
}

/** The stored form of a Temporal value, as `stored` writes its ISO text. A value of another kind, in a calendar other than ISO 8601, or with digits below a microsecond, which MySQL does not hold, is refused. */
export function storedTextOfTemporal(
  identity: TemporalCodecIdentity,
  value: TemporalValue,
  stored: StoredText,
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
      if (hasDigitsBelow(encoded.text, 6)) {
        throw errorDateTimeUnwritable({
          codecId: identity.codecId,
          received: `the ${identity.temporalTag} ${encoded.text}`,
          detail:
            "It has digits below a microsecond, and MySQL holds microseconds at most. Round it first, as in value.round({ smallestUnit: 'microsecond', roundingMode: 'trunc' }).",
        });
      }
      return storedTextForWrite(identity.codecId, encoded.text, stored);
  }
}

const WIRE_DATE_TIME = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/;

/** The instant the text MySQL sends for a `datetime` or a `timestamp` names in UTC: every session runs in UTC, so the text holds no time zone of its own. */
export function dateOfWireText(codecId: string, wire: string): Date {
  const match = WIRE_DATE_TIME.exec(wire);
  const date = match === null ? undefined : new Date(`${match[1]}T${match[2]}Z`);
  if (date === undefined || !isValidDate(date)) {
    throw mysqlError(
      'RUNTIME.DECODE_FAILED',
      `${codecId} wire value must be a date and time as MySQL prints it`,
      {
        meta: { codecId, received: String(wire) },
      },
    );
  }
  return date;
}

/** The text MySQL reads for a `Date` in UTC, with millisecond digits. An Invalid Date, and an instant `stored` refuses, are refused. */
export function wireTextOfDate(codecId: string, value: Date, stored: StoredText): string {
  if (!isValidDate(value)) {
    throw mysqlError('RUNTIME.ENCODE_FAILED', `${codecId} value must be a valid Date`, {
      meta: { codecId, received: String(value) },
    });
  }
  const text = value.toISOString();
  storedTextForWrite(codecId, text, (instant) =>
    utcDateTimeOfInstantText(codecId, instant, stored),
  );
  return mysqlWireText(withoutUtcDesignator(text));
}

/** The fraction digits a column with `params` holds: its `precision`, or 0, which MySQL holds when none is written. */
export function precisionOf(params: DataTypeParams): number {
  const precision = params['precision'];
  return typeof precision === 'number' ? precision : 0;
}

/** `stored`, a contract value of a column with `params`; a value with more fraction digits than the column holds, which MySQL would round, is refused. */
export function storedWithinPrecision(
  codecId: string,
  stored: string,
  params: DataTypeParams,
): string {
  const precision = precisionOf(params);
  if (!hasDigitsBelow(stored, precision)) return stored;
  return refuseJsonValue(
    codecId,
    `a value with at most ${precision} ${precision === 1 ? 'fraction digit' : 'fraction digits'} of a second, which precision ${precision} holds without rounding`,
    stored,
  );
}
