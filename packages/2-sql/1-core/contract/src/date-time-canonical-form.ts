/**
 * The reader the SQL targets build the canonical form of each date and time type with; ADR 254
 * states the forms and the text it reads.
 */

import { InternalError } from '@internal/utils/internal-error';
import { structuredError } from '@internal/utils/structured-error';

/** What a date or time type holds, which decides the text it reads and writes. */
export type DateTimeShape = 'date' | 'time' | 'timeWithOffset' | 'dateTime' | 'instant';

export interface CanonicalDateTimeOptions {
  readonly shape: DateTimeShape;
  /** The id of the data type or codec that declares this canonical form, which messages name. */
  readonly ownerId: string;
  /** The largest UTC offset the type holds, in hours. Defaults to 23. */
  readonly maxOffsetHours?: number;
  /** The most digits after the decimal point the type holds. Defaults to 6, microseconds. */
  readonly maxFractionDigits?: 3 | 6;
  /** The earliest and latest values the type holds, each in canonical form. */
  readonly range?: { readonly earliest: string; readonly latest: string };
}

interface DateFields {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

interface TimeFields {
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly fraction: string;
}

interface WrittenDateTime {
  readonly date: DateFields | undefined;
  readonly time: TimeFields | undefined;
  readonly offsetSeconds: number | undefined;
  readonly fractionDigits: number;
}

const SHAPES: Readonly<
  Record<
    DateTimeShape,
    {
      readonly description: string;
      readonly plural: string;
      readonly example: string;
      readonly date: boolean;
      readonly time: boolean;
      readonly offset: boolean;
    }
  >
> = {
  date: {
    description: 'a date',
    plural: 'dates',
    example: '2024-01-01',
    date: true,
    time: false,
    offset: false,
  },
  time: {
    description: 'a time of day',
    plural: 'times of day',
    example: '12:34:56',
    date: false,
    time: true,
    offset: false,
  },
  timeWithOffset: {
    description: 'a time of day with a UTC offset',
    plural: 'times of day with a UTC offset',
    example: '12:34:56+02:00',
    date: false,
    time: true,
    offset: true,
  },
  dateTime: {
    description: 'a date and time',
    plural: 'dates and times',
    example: '2024-01-01T12:34:56',
    date: true,
    time: true,
    offset: false,
  },
  instant: {
    description: 'a date and time with a UTC offset',
    plural: 'instants',
    example: '2024-01-01T12:34:56Z',
    date: true,
    time: true,
    offset: true,
  },
};

const DATE_PREFIX = /^([+-]\d{6}|\d{4})-(\d{2})-(\d{2})/;
const TIME_PREFIX = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?/;
const OFFSET = /^([+-])(\d{2})(?::(\d{2})(?::(\d{2}))?)?$/;
const MAX_FRACTION_DIGITS = 6;
const FRACTION_UNITS = { 3: 'milliseconds', 6: 'microseconds' } as const;
const SECONDS_PER_DAY = 86_400;
const MIDNIGHT: TimeFields = { hour: 0, minute: 0, second: 0, fraction: '' };

function refused(message: string): never {
  throw structuredError('CONTRACT.CAST_REFUSED', message, {
    why: 'A date or time type stores one canonical form for each value (ADR 254).',
    fix: 'Write text the type holds, as the message shows.',
  });
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** Days from 1970-01-01 to a date of the proleptic Gregorian calendar, with year 0 as 1 BC. */
function daysFromCivil({ year, month, day }: DateFields): number {
  const shifted = month <= 2 ? year - 1 : year;
  const era = Math.floor(shifted / 400);
  const yearOfEra = shifted - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146_097 + dayOfEra - 719_468;
}

function civilFromDays(days: number): DateFields {
  const shifted = days + 719_468;
  const era = Math.floor(shifted / 146_097);
  const dayOfEra = shifted - era * 146_097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36_524) -
      Math.floor(dayOfEra / 146_096)) /
      365,
  );
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthIndex = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * monthIndex + 2) / 5) + 1;
  const month = monthIndex < 10 ? monthIndex + 3 : monthIndex - 9;
  return { year: yearOfEra + era * 400 + (month <= 2 ? 1 : 0), month, day };
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

function yearText(year: number): string {
  if (year >= 0 && year <= 9999) return pad(year, 4);
  return `${year < 0 ? '-' : '+'}${pad(Math.abs(year), 6)}`;
}

function dateText(date: DateFields): string {
  return `${yearText(date.year)}-${pad(date.month)}-${pad(date.day)}`;
}

function timeText(time: TimeFields): string {
  const fraction = time.fraction.replace(/0+$/, '');
  return `${pad(time.hour)}:${pad(time.minute)}:${pad(time.second)}${fraction === '' ? '' : `.${fraction}`}`;
}

function offsetText(seconds: number): string {
  if (seconds === 0) return 'Z';
  const magnitude = Math.abs(seconds);
  const rest = magnitude % 60;
  return `${seconds < 0 ? '-' : '+'}${pad(Math.floor(magnitude / 3600))}:${pad(Math.floor(magnitude / 60) % 60)}${rest === 0 ? '' : `:${pad(rest)}`}`;
}

/**
 * The fields of an ISO 8601 date, time, or date and time, or `undefined` when the text is not one.
 * Ranges are checked by the caller, which words the refusal.
 */
function readWritten(text: string): WrittenDateTime | undefined {
  let rest = text;
  let date: DateFields | undefined;
  let timeFollows = true;
  const dateMatch = DATE_PREFIX.exec(rest);
  if (dateMatch !== null) {
    const [whole, yearDigits = '', month = '', day = ''] = dateMatch;
    if (yearDigits === '-000000') return undefined;
    date = { year: Number(yearDigits), month: Number(month), day: Number(day) };
    rest = rest.slice(whole.length);
    timeFollows = /^[Tt ]/.test(rest);
    if (timeFollows) rest = rest.slice(1);
  }

  let time: TimeFields | undefined;
  let fractionDigits = 0;
  if (timeFollows) {
    const timeMatch = TIME_PREFIX.exec(rest);
    if (timeMatch === null) return undefined;
    const [whole, hour = '', minute = '', second = '00', fraction = ''] = timeMatch;
    time = { hour: Number(hour), minute: Number(minute), second: Number(second), fraction };
    fractionDigits = fraction.length;
    rest = rest.slice(whole.length);
  }

  let offsetSeconds: number | undefined;
  if (rest === 'Z' || rest === 'z') {
    offsetSeconds = 0;
  } else if (rest !== '') {
    const offset = OFFSET.exec(rest);
    if (offset === null) return undefined;
    const [, sign, hours = '', minutes = '00', seconds = '00'] = offset;
    if (Number(minutes) > 59 || Number(seconds) > 59) return undefined;
    const magnitude = Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
    offsetSeconds = sign === '-' ? -magnitude : magnitude;
  }
  return { date, time, offsetSeconds, fractionDigits };
}

function withFraction(example: string, digits: number): string {
  return example.replace(/(\d{2}:\d{2}:\d{2})/, `$1.${'123456'.slice(0, digits)}`);
}

/** A value's position on its type's scale, compared element by element; the date is in UTC for an instant. */
type Position = readonly [days: number, seconds: number, fraction: string];

interface Normalized {
  readonly date: DateFields | undefined;
  readonly time: TimeFields;
  readonly offsetSeconds: number;
}

/** The value with an instant moved to UTC. */
function normalized(written: WrittenDateTime, shape: DateTimeShape): Normalized {
  const clock = written.time ?? MIDNIGHT;
  const offsetSeconds = written.offsetSeconds ?? 0;
  if (written.date === undefined || shape !== 'instant') {
    return { date: written.date, time: clock, offsetSeconds };
  }
  const utc =
    daysFromCivil(written.date) * SECONDS_PER_DAY +
    clock.hour * 3600 +
    clock.minute * 60 +
    clock.second -
    offsetSeconds;
  const days = Math.floor(utc / SECONDS_PER_DAY);
  const secondOfDay = utc - days * SECONDS_PER_DAY;
  return {
    date: civilFromDays(days),
    time: {
      hour: Math.floor(secondOfDay / 3600),
      minute: Math.floor(secondOfDay / 60) % 60,
      second: secondOfDay % 60,
      fraction: clock.fraction,
    },
    offsetSeconds: 0,
  };
}

function position(value: Normalized): Position {
  const { time } = value;
  return [
    value.date === undefined ? 0 : daysFromCivil(value.date),
    time.hour * 3600 + time.minute * 60 + time.second,
    time.fraction.padEnd(MAX_FRACTION_DIGITS, '0'),
  ];
}

function isBefore(left: Position, right: Position): boolean {
  if (left[0] !== right[0]) return left[0] < right[0];
  if (left[1] !== right[1]) return left[1] < right[1];
  return left[2] < right[2];
}

function printed(value: Normalized, shape: DateTimeShape): string {
  const { date, time, offsetSeconds } = value;
  if (date === undefined) {
    return shape === 'timeWithOffset'
      ? `${timeText(time)}${offsetText(offsetSeconds)}`
      : timeText(time);
  }
  if (shape === 'date') return dateText(date);
  if (shape === 'dateTime') return `${dateText(date)}T${timeText(time)}`;
  return `${dateText(date)}T${timeText(time)}Z`;
}

/** The position of a range bound, which the data type declares in canonical form. */
function boundPosition(text: string, shape: DateTimeShape): Position {
  const written = readWritten(text);
  if (written === undefined) {
    throw new InternalError(`The range bound "${text}" is not in canonical form.`);
  }
  return position(normalized(written, shape));
}

/**
 * The canonical form of written date or time text, or a refusal with a message that says what is
 * wrong and shows text the type holds. `written` is the text as its author wrote it, which the
 * message shows, when a target rewrote it into ISO 8601 before calling this.
 */
export function canonicalDateTime(
  text: string,
  options: CanonicalDateTimeOptions,
  written: string = text,
): string {
  const shape = SHAPES[options.shape];
  const { ownerId: id } = options;

  const parts = readWritten(text);
  if (parts === undefined) {
    refused(
      `${id} cannot read "${written}". Write ${shape.description}, as in "${shape.example}".`,
    );
  }
  if (parts.date !== undefined && !shape.date) {
    refused(
      `${id} holds a time of day without a date, but "${written}" has a date. Write the time alone, as in "${shape.example}".`,
    );
  }
  if (parts.date === undefined && shape.date) {
    refused(
      shape.time
        ? `${id} holds ${shape.description}, but "${written}" has no date. Write the date too, as in "${shape.example}".`
        : `${id} holds a date, and "${written}" is a time of day. Write a date, as in "${shape.example}".`,
    );
  }
  if (parts.time !== undefined && !shape.time) {
    refused(
      `${id} holds a date without a time of day, but "${written}" has a time. Write the date alone, as in "${shape.example}".`,
    );
  }
  if (parts.time === undefined && shape.offset) {
    refused(
      `${id} holds ${shape.description}, but "${written}" has no time of day. Write the time too, as in "${shape.example}".`,
    );
  }
  if (parts.offsetSeconds !== undefined && !shape.offset) {
    refused(
      `${id} holds no UTC offset, but "${written}" has one. Leave it out, as in "${shape.example}".`,
    );
  }
  if (parts.offsetSeconds === undefined && shape.offset) {
    refused(
      `${id} needs a UTC offset, but "${written}" has none. Add Z for UTC or an offset such as +02:00, as in "${shape.example}".`,
    );
  }
  const maxFractionDigits = options.maxFractionDigits ?? MAX_FRACTION_DIGITS;
  if (parts.fractionDigits > maxFractionDigits) {
    refused(
      `"${written}" has ${parts.fractionDigits} digits after the decimal point, but ${id} holds ${FRACTION_UNITS[maxFractionDigits]}, so at most ${maxFractionDigits}. Round it, as in "${withFraction(shape.example, maxFractionDigits)}".`,
    );
  }

  const { date, time } = parts;
  if (
    date !== undefined &&
    (date.month < 1 ||
      date.month > 12 ||
      date.day < 1 ||
      date.day > daysInMonth(date.year, date.month))
  ) {
    refused(`"${written}" is not a date that exists. Write a real date, as in "${shape.example}".`);
  }
  if (time !== undefined && (time.hour > 23 || time.minute > 59 || time.second > 59)) {
    refused(
      `"${written}" is not a time of day that exists: hours run from 00 to 23, and minutes and seconds from 00 to 59. Write one, as in "${shape.example}".`,
    );
  }
  const offsetLimit = options.maxOffsetHours ?? 23;
  if (
    parts.offsetSeconds !== undefined &&
    Math.abs(parts.offsetSeconds) >= (offsetLimit + 1) * 3600
  ) {
    refused(
      `"${written}" has a UTC offset outside -${pad(offsetLimit)}:59 to +${pad(offsetLimit)}:59, which ${id} does not hold. Write a smaller offset, as in "${shape.example}".`,
    );
  }

  const value = normalized(parts, options.shape);
  const { range } = options;
  if (range !== undefined) {
    const at = position(value);
    if (
      isBefore(at, boundPosition(range.earliest, options.shape)) ||
      isBefore(boundPosition(range.latest, options.shape), at)
    ) {
      refused(
        `${id} holds ${shape.plural} from ${range.earliest} to ${range.latest}, and "${written}" is outside them.`,
      );
    }
  }
  return printed(value, options.shape);
}
