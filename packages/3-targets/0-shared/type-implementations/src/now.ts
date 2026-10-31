import type { Temporal } from 'temporal-spec';
import type { TemporalImplementation } from './temporal';

/**
 * The ids of the "now" generators, as contracts store them, and the values they produce. Each id names the value, not a database type, so every target can store it. Every value reads the clock through `Date.now()` and is in UTC. A value with a time rounds down to the fraction digits it is given, so the column stores the value as written. The text values are ISO 8601, with the fraction written in the {@link FractionForm} the target stores.
 */
export const INSTANT_NOW_GENERATOR_ID = 'instantNow' as const;
export const PLAIN_DATE_TIME_NOW_GENERATOR_ID = 'plainDateTimeNow' as const;
export const PLAIN_DATE_NOW_GENERATOR_ID = 'plainDateNow' as const;
export const PLAIN_TIME_NOW_GENERATOR_ID = 'plainTimeNow' as const;
export const INSTANT_STRING_NOW_GENERATOR_ID = 'instantStringNow' as const;
export const DATE_STRING_NOW_GENERATOR_ID = 'dateStringNow' as const;
export const TIME_STRING_NOW_GENERATOR_ID = 'timeStringNow' as const;

/** How a text value writes its fraction of a second: `trimmed` drops trailing zeros, and the point when no digit is left; `fixed` writes every digit it is given. */
export type FractionForm = 'trimmed' | 'fixed';

const UTC_OFFSET = 'Z';
const MILLISECOND_DIGITS = 3;

export type GeneratorParams = Readonly<Record<string, unknown>> | undefined;

/** The generator's `precision` param, else `maxFractionDigits`. */
export function fractionDigitsOf(params: GeneratorParams, maxFractionDigits: number): number {
  const precision = params?.['precision'];
  return typeof precision === 'number' ? precision : maxFractionDigits;
}

function utcNow(
  fractionDigits: number,
  form: FractionForm,
): { readonly date: string; readonly time: string } {
  const iso = new Date(Date.now()).toISOString();
  const [wholeSeconds = '', fraction = ''] = iso.slice(11, -1).split('.');
  const digits = fraction.slice(0, fractionDigits);
  const kept = form === 'fixed' ? digits.padEnd(fractionDigits, '0') : digits.replace(/0+$/, '');
  return {
    date: iso.slice(0, 10),
    time: kept === '' ? wholeSeconds : `${wholeSeconds}.${kept}`,
  };
}

/** Rounds down, so a database that rounds to the column's precision stores the value as written, rather than rounding it up, which can reach `24:00:00`. */
function truncateTime(time: Temporal.PlainTime, fractionDigits: number): Temporal.PlainTime {
  if (fractionDigits <= 0) return time.round({ smallestUnit: 'second', roundingMode: 'trunc' });
  const smallestUnit = fractionDigits <= 3 ? 'millisecond' : 'microsecond';
  const unitDigits = fractionDigits <= 3 ? 3 : 6;
  return time.round({
    smallestUnit,
    roundingIncrement: 10 ** (unitDigits - Math.min(fractionDigits, unitDigits)),
    roundingMode: 'trunc',
  });
}

function epochMillisecondsNow(fractionDigits: number): number {
  const now = Date.now();
  if (fractionDigits >= MILLISECOND_DIGITS) return now;
  const step = 10 ** (MILLISECOND_DIGITS - Math.max(fractionDigits, 0));
  return Math.floor(now / step) * step;
}

function utcDateTimeNow(
  temporal: TemporalImplementation,
  fractionDigits: number,
): Temporal.ZonedDateTime {
  return instantNow(temporal, fractionDigits).toZonedDateTimeISO('UTC');
}

export function instantNow(
  temporal: TemporalImplementation,
  fractionDigits: number,
): Temporal.Instant {
  return temporal.Instant.fromEpochMilliseconds(epochMillisecondsNow(fractionDigits));
}

export function plainDateTimeNow(
  temporal: TemporalImplementation,
  fractionDigits: number,
): Temporal.PlainDateTime {
  return utcDateTimeNow(temporal, fractionDigits).toPlainDateTime();
}

export function plainDateNow(temporal: TemporalImplementation): Temporal.PlainDate {
  return utcDateTimeNow(temporal, MILLISECOND_DIGITS).toPlainDate();
}

export function plainTimeNow(
  temporal: TemporalImplementation,
  fractionDigits: number,
): Temporal.PlainTime {
  return truncateTime(utcDateTimeNow(temporal, MILLISECOND_DIGITS).toPlainTime(), fractionDigits);
}

/** The current UTC date and time, as ISO 8601 text without an offset. */
export function dateTimeStringNow(fractionDigits: number, form: FractionForm): string {
  const { date, time } = utcNow(fractionDigits, form);
  return `${date}T${time}`;
}

/** The current instant, as ISO 8601 text in UTC. */
export function instantStringNow(fractionDigits: number, form: FractionForm): string {
  return `${dateTimeStringNow(fractionDigits, form)}${UTC_OFFSET}`;
}

export function dateStringNow(): string {
  return utcNow(MILLISECOND_DIGITS, 'trimmed').date;
}

/** The current UTC time of day, as ISO 8601 text. */
export function timeStringNow(fractionDigits: number, form: FractionForm): string {
  return utcNow(fractionDigits, form).time;
}
