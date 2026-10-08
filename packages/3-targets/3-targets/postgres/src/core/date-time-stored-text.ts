/**
 * The stored text of the date and time types: the canonical form a value of the type takes (ADR
 * 254), and what PostgreSQL writes for the type as text and as JSON under the ISO DateStyle. Each
 * type's reader reads these and refuses any other text.
 *
 * PostgreSQL holds values the canonical form does not: a date up to the year 5874897, and
 * `24:00:00` as a time of day. So the check is of the form and of a real date and time of day, and
 * the range is PostgreSQL's to keep. A year counts only for its leap days, which repeat every 400
 * years.
 */

import type { JsonValue } from '@internal/contract/types';
import { readJsonMatching, refuseJsonValue } from '@internal/framework-components/codec';
import { canonicalDateTime, type DateTimeShape } from '@internal/sql-contract/data-type-support';
import { isStructuredError } from '@internal/utils/structured-error';

const YEAR = String.raw`(?:[+-]\d{6}|\d{4,7})`;
const DATE = String.raw`${YEAR}-\d{2}-\d{2}`;
const TIME = String.raw`\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?`;
const OFFSET = String.raw`(?:Z|[+-]\d{2}(?::\d{2}(?::\d{2})?)?)`;
const INFINITY = 'infinity|-infinity|';
const BC = '(?: BC)?';

const FORMS: Readonly<Record<DateTimeShape, string>> = {
  date: `${DATE}${BC}`,
  time: TIME,
  timeWithOffset: `${TIME}${OFFSET}`,
  dateTime: `${DATE}[ T]${TIME}${BC}`,
  instant: `${DATE}[ T]${TIME}${OFFSET}${BC}`,
};

const DATED = /^([+-]?)(\d{4,7})(-.*?)( BC)?$/;
const END_OF_DAY = /^24:00:00(?:\.0+)?(?![.\d])/;

/** PostgreSQL's largest UTC offset, which it writes for no type past 15:59:59. */
const MAX_OFFSET_HOURS = 15;

export interface StoredDateTimeText {
  readonly dataType: string;
  readonly shape: DateTimeShape;
  readonly pattern: RegExp;
  readonly description: string;
  readonly endOfDay: boolean;
}

function storedText(options: {
  readonly dataType: string;
  readonly shape: DateTimeShape;
  readonly description: string;
  readonly infinity: boolean;
  readonly endOfDay: boolean;
}): StoredDateTimeText {
  return {
    dataType: options.dataType,
    shape: options.shape,
    pattern: new RegExp(`^(?:${options.infinity ? INFINITY : ''}${FORMS[options.shape]})$`),
    description: `${options.description} in ISO 8601 or as PostgreSQL writes it`,
    endOfDay: options.endOfDay,
  };
}

export const pgDateStoredText = storedText({
  dataType: 'pg/date',
  shape: 'date',
  description: 'a date',
  infinity: true,
  endOfDay: false,
});
export const pgTimeStoredText = storedText({
  dataType: 'pg/time',
  shape: 'time',
  description: 'a time of day',
  infinity: false,
  endOfDay: true,
});
export const pgTimetzStoredText = storedText({
  dataType: 'pg/timetz',
  shape: 'timeWithOffset',
  description: 'a time of day with a UTC offset',
  infinity: false,
  endOfDay: true,
});
export const pgTimestampStoredText = storedText({
  dataType: 'pg/timestamp',
  shape: 'dateTime',
  description: 'a date and time of day',
  infinity: true,
  endOfDay: false,
});
export const pgTimestamptzStoredText = storedText({
  dataType: 'pg/timestamptz',
  shape: 'instant',
  description: 'a date and time of day with a UTC offset',
  infinity: true,
  endOfDay: false,
});

/** The text with its year moved into the 400-year cycle from 2000, or `undefined` for a year no calendar has. */
function inGregorianCycle(text: string): string | undefined {
  const match = DATED.exec(text);
  if (match === null) return text;
  const [, sign = '', digits = '', rest = '', bc] = match;
  const year = Number(digits);
  if ((bc !== undefined && (sign !== '' || year === 0)) || (sign === '-' && year === 0)) {
    return undefined;
  }
  const astronomical = bc !== undefined ? 1 - year : sign === '-' ? -year : year;
  return `${2000 + (((astronomical % 400) + 400) % 400)}${rest}`;
}

function holdsValue(stored: StoredDateTimeText, text: string): boolean {
  if (text === 'infinity' || text === '-infinity') return true;
  const cycled = inGregorianCycle(text);
  if (cycled === undefined) return false;
  const read = stored.endOfDay ? cycled.replace(END_OF_DAY, '00:00:00') : cycled;
  try {
    canonicalDateTime(read, {
      shape: stored.shape,
      ownerId: stored.dataType,
      maxOffsetHours: MAX_OFFSET_HOURS,
    });
    return true;
  } catch (error) {
    if (isStructuredError(error) && error.code === 'CONTRACT.CAST_REFUSED') return false;
    throw error;
  }
}

/** Reads the stored text of a date or time type, refusing text in another form or naming no real date and time. */
export function readJsonDateTimeText(json: JsonValue, stored: StoredDateTimeText): string {
  const text = readJsonMatching(stored.dataType, json, stored.pattern, stored.description);
  return holdsValue(stored, text)
    ? text
    : refuseJsonValue(stored.dataType, stored.description, json);
}
