import { hasDigitsBelowAMillisecond } from '@internal/type-implementations/date';
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
  sqliteError,
} from './errors';
import { requireTemporal } from './require-temporal';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME_WITHOUT_OFFSET = /^(\d{4}-\d{2}-\d{2})[Tt ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)$/;

/** A date alone as its midnight in UTC, and a date and time without an offset as UTC. */
function asUtcWhenUnmarked(text: string): string {
  if (DATE_ONLY.test(text)) return `${text}T00:00:00Z`;
  const unmarked = DATE_TIME_WITHOUT_OFFSET.exec(text);
  return unmarked === null ? text : `${unmarked[1]}T${unmarked[2]}Z`;
}

/**
 * The instant SQLite holds for a row, in milliseconds since 1970, read as `Date` reads it, with text without a UTC offset read as UTC, as SQLite's own date and time functions read it, never in the machine's time zone. A number is milliseconds since 1970, as the Prisma ORM query engine wrote a `DateTime`. Digits below a millisecond are cut, as `Date` cuts them.
 */
export function sqliteInstantMilliseconds(codecId: string, value: string | number): number {
  const milliseconds = new Date(
    typeof value === 'number' ? value : asUtcWhenUnmarked(value),
  ).getTime();
  if (Number.isNaN(milliseconds)) {
    throw sqliteError(
      'RUNTIME.DECODE_FAILED',
      `${codecId} wire value must be a date and time as text, or a number of milliseconds since 1970: ${String(value)}`,
      { meta: { codecId, received: String(value) } },
    );
  }
  return milliseconds;
}

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

/** The stored form of the text SQLite returned for a row, as `stored` reads it; text `stored` refuses is refused as `RUNTIME.DECODE_FAILED`. */
export function storedTextFromWire(
  codecId: string,
  wire: unknown,
  stored: (text: string) => string,
): string {
  if (typeof wire !== 'string') {
    throw errorDateTimeUnreadable({
      codecId,
      value: String(wire),
      detail: `SQLite returned ${describeValue(wire)}, not text.`,
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
            "It has digits below a millisecond, and the column holds milliseconds. Round it first, as in value.round({ smallestUnit: 'millisecond', roundingMode: 'trunc' }).",
        });
      }
      return storedTextForWrite(identity.codecId, encoded.text, stored);
  }
}
