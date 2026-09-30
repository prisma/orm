/**
 * Reading written date and time text into the standard text of a date or time data type.
 *
 * The standard text is the text `Temporal` prints: `2024-01-01`, `12:34:56`, `2024-01-01T12:34:56`,
 * and an instant in UTC as `2024-01-01T12:34:56Z`. A fraction of a second has no trailing zeros and
 * at most six digits. A year outside 0000 to 9999 is a sign and six digits.
 *
 * The reader takes ISO 8601 text and the forms databases print it in: a space in place of `T`, an
 * offset of `+HH`, `+HH:MM` or `+HH:MM:SS`, a year of five or six digits, and a ` BC` suffix. It
 * uses no `Temporal` and no JavaScript `Date`, so a default reads the same on every runtime. Each
 * target declares its own date and time types with these shapes. ADR 254.
 */

import { structuredError } from '@internal/utils/structured-error';

/** What a date or time type holds, which decides the text it reads and prints. */
export type DateTimeShape = 'date' | 'time' | 'timeWithOffset' | 'dateTime' | 'instant';

export interface DateTimeTextOptions {
  readonly shape: DateTimeShape;
  /** The data type id, which messages name. */
  readonly typeName: string;
  /** Whether `infinity` and `-infinity` are values of the type. */
  readonly infinity: boolean;
  /** The largest UTC offset the type holds, in hours. Defaults to 23. */
  readonly maxOffsetHours?: number;
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
      readonly example: string;
      readonly date: boolean;
      readonly time: boolean;
      readonly offset: boolean;
    }
  >
> = {
  date: { description: 'a date', example: '2024-01-01', date: true, time: false, offset: false },
  time: {
    description: 'a time of day',
    example: '12:34:56',
    date: false,
    time: true,
    offset: false,
  },
  timeWithOffset: {
    description: 'a time of day with a UTC offset',
    example: '12:34:56+02:00',
    date: false,
    time: true,
    offset: true,
  },
  dateTime: {
    description: 'a date and time',
    example: '2024-01-01T12:34:56',
    date: true,
    time: true,
    offset: false,
  },
  instant: {
    description: 'a date and time with a UTC offset',
    example: '2024-01-01T12:34:56Z',
    date: true,
    time: true,
    offset: true,
  },
};

const INFINITIES: ReadonlySet<string> = new Set(['infinity', '-infinity']);
const BC_SUFFIX = ' BC';
const DATE_PREFIX = /^([+-]\d{6}|\d{4,6})-(\d{2})-(\d{2})/;
const TIME_PREFIX = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?/;
const OFFSET = /^([+-])(\d{2})(?::(\d{2})(?::(\d{2}))?)?$/;
const MAX_FRACTION_DIGITS = 6;
const SECONDS_PER_DAY = 86_400;

function refused(message: string): never {
  throw structuredError('CONTRACT.CAST_REFUSED', message, {
    why: 'A date or time type stores one standard text, the text Temporal prints, and reads ISO 8601 text and the forms databases print it in.',
    fix: 'Write the value in ISO 8601 form, as the message shows.',
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
 * The fields of a written value, or `undefined` when the text is not a date, a time, or a date and
 * time in a form this reader takes. Ranges are checked by the caller, which words the refusal.
 */
function readWritten(text: string): WrittenDateTime | undefined {
  const isBc = text.endsWith(BC_SUFFIX);
  let rest = isBc ? text.slice(0, -BC_SUFFIX.length) : text;

  let date: DateFields | undefined;
  let timeFollows = true;
  const dateMatch = DATE_PREFIX.exec(rest);
  if (dateMatch !== null) {
    const [whole, yearDigits = '', month = '', day = ''] = dateMatch;
    const signed = yearDigits.startsWith('+') || yearDigits.startsWith('-');
    const written = Number(yearDigits);
    if (yearDigits === '-000000' || (isBc && (signed || written === 0))) return undefined;
    date = { year: isBc ? 1 - written : written, month: Number(month), day: Number(day) };
    rest = rest.slice(whole.length);
    timeFollows = /^[Tt ]/.test(rest);
    if (timeFollows) rest = rest.slice(1);
  } else if (isBc) {
    return undefined;
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

function withFraction(example: string): string {
  return example.replace(/(\d{2}:\d{2}:\d{2})/, '$1.123456');
}

/**
 * Turn written text into the standard text of a date or time type, or refuse it with a message
 * that says what is wrong and shows text the type takes.
 */
export function standardDateTimeText(text: string, options: DateTimeTextOptions): string {
  const shape = SHAPES[options.shape];
  const { typeName } = options;
  if (options.infinity && INFINITIES.has(text)) return text;

  const written = readWritten(text);
  if (written === undefined) {
    refused(
      `${typeName} cannot read "${text}". Write ${shape.description}, as in "${shape.example}".`,
    );
  }
  if (written.date !== undefined && !shape.date) {
    refused(
      `${typeName} holds a time of day without a date, but "${text}" has a date. Write the time alone, as in "${shape.example}".`,
    );
  }
  if (written.date === undefined && shape.date) {
    refused(
      `${typeName} holds ${shape.description}, but "${text}" has no date. Write the date too, as in "${shape.example}".`,
    );
  }
  if (written.time !== undefined && !shape.time) {
    refused(
      `${typeName} holds a date without a time of day, but "${text}" has a time. Write the date alone, as in "${shape.example}".`,
    );
  }
  if (written.time === undefined && shape.offset) {
    refused(
      `${typeName} holds ${shape.description}, but "${text}" has no time of day. Write the time too, as in "${shape.example}".`,
    );
  }
  if (written.offsetSeconds !== undefined && !shape.offset) {
    refused(
      `${typeName} holds no UTC offset, but "${text}" has one. Leave it out, as in "${shape.example}".`,
    );
  }
  if (written.offsetSeconds === undefined && shape.offset) {
    refused(
      `${typeName} needs a UTC offset, but "${text}" has none. Add Z for UTC or an offset such as +02:00, as in "${shape.example}".`,
    );
  }
  if (written.fractionDigits > MAX_FRACTION_DIGITS) {
    refused(
      `"${text}" has ${written.fractionDigits} digits after the decimal point, but ${typeName} keeps at most ${MAX_FRACTION_DIGITS}, which is microseconds. Round it, as in "${withFraction(shape.example)}".`,
    );
  }

  const { date, time } = written;
  if (
    date !== undefined &&
    (date.month < 1 ||
      date.month > 12 ||
      date.day < 1 ||
      date.day > daysInMonth(date.year, date.month))
  ) {
    refused(`"${text}" is not a date that exists. Write a real date, as in "${shape.example}".`);
  }
  if (time !== undefined && (time.hour > 23 || time.minute > 59 || time.second > 59)) {
    refused(
      `"${text}" is not a time of day that exists: hours run from 00 to 23, and minutes and seconds from 00 to 59. Write one, as in "${shape.example}".`,
    );
  }
  const offsetLimit = options.maxOffsetHours ?? 23;
  if (
    written.offsetSeconds !== undefined &&
    Math.abs(written.offsetSeconds) >= (offsetLimit + 1) * 3600
  ) {
    refused(
      `"${text}" has a UTC offset outside -${pad(offsetLimit)}:59 to +${pad(offsetLimit)}:59, which ${typeName} does not hold. Write a smaller offset, as in "${shape.example}".`,
    );
  }

  return printed(written, options.shape);
}

const MIDNIGHT: TimeFields = { hour: 0, minute: 0, second: 0, fraction: '' };

/** The standard text of a written value whose parts the shape's checks have already admitted. */
function printed(written: WrittenDateTime, shape: DateTimeShape): string {
  const { date, offsetSeconds = 0 } = written;
  const clock = written.time ?? MIDNIGHT;
  if (date === undefined) {
    return shape === 'timeWithOffset'
      ? `${timeText(clock)}${offsetText(offsetSeconds)}`
      : timeText(clock);
  }
  if (shape === 'date') return dateText(date);
  if (shape === 'dateTime') return `${dateText(date)}T${timeText(clock)}`;
  const utc =
    daysFromCivil(date) * SECONDS_PER_DAY +
    clock.hour * 3600 +
    clock.minute * 60 +
    clock.second -
    offsetSeconds;
  const days = Math.floor(utc / SECONDS_PER_DAY);
  const secondOfDay = utc - days * SECONDS_PER_DAY;
  const utcClock: TimeFields = {
    hour: Math.floor(secondOfDay / 3600),
    minute: Math.floor(secondOfDay / 60) % 60,
    second: secondOfDay % 60,
    fraction: clock.fraction,
  };
  return `${dateText(civilFromDays(days))}T${timeText(utcClock)}Z`;
}
