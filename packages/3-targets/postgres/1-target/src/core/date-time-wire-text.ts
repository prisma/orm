import { type DateTimeShape, dateTimeStoredText } from '@internal/framework-components/codec';
import { ifDefined } from '@internal/utils/defined';
import { errorDateStyleNotIso } from './errors';
import { isoYearText } from './postgres-year-text';

export interface DateTimeWireReading {
  readonly shape: DateTimeShape;
  readonly holdsInfinity: boolean;
  readonly maxOffsetHours?: number;
}

const INFINITIES: ReadonlySet<string> = new Set(['infinity', '-infinity']);
const ISO_DATE_PREFIX = /^[+-]?\d{4,}-\d{2}-\d{2}/;
const LONG_YEAR_DATE = /^(\d{7,})(-\d{2}-\d{2})$/;
const END_OF_DAY = '24:00:00';
const MIDNIGHT = '00:00:00';

/** `wire`, a date or timestamp PostgreSQL printed or its ISO 8601 stored form, unless it printed it under a DateStyle other than ISO, which is refused. `infinity` and `-infinity` print the same in every style. */
export function requireIsoDateStyle(codecId: string, wire: string): string {
  if (INFINITIES.has(wire) || ISO_DATE_PREFIX.test(wire)) return wire;
  throw errorDateStyleNotIso(codecId, wire);
}

/**
 * The stored form (ADR 254, "Date and time types") of the text PostgreSQL prints for a date or time type under DateStyle ISO, with the UTC offset of an instant converted to UTC. A value PostgreSQL holds beyond the stored form's range is read as ISO text of the same shape: a year of seven digits keeps them all, as in `+5874897-12-31`, and the end of the day stays `24:00:00`. Text PostgreSQL prints under another DateStyle is refused.
 */
export function storedTextFromWire(
  codecId: string,
  reading: DateTimeWireReading,
  wire: string,
): string {
  if (reading.holdsInfinity && INFINITIES.has(wire)) return wire;
  const hasDate = reading.shape !== 'time' && reading.shape !== 'timeWithOffset';
  if (hasDate) requireIsoDateStyle(codecId, wire);

  const longYear = reading.shape === 'date' ? LONG_YEAR_DATE.exec(wire) : null;
  if (longYear !== null) return `+${longYear[1]}${longYear[2]}`;

  if (!hasDate && wire.startsWith(END_OF_DAY)) {
    const read = storedText(codecId, reading, `${MIDNIGHT}${wire.slice(END_OF_DAY.length)}`);
    return `${END_OF_DAY}${read.slice(MIDNIGHT.length)}`;
  }
  return storedText(codecId, reading, wire);
}

function storedText(codecId: string, reading: DateTimeWireReading, wire: string): string {
  return dateTimeStoredText(
    isoYearText(wire),
    {
      shape: reading.shape,
      ownerId: codecId,
      ...ifDefined('maxOffsetHours', reading.maxOffsetHours),
    },
    wire,
  );
}
