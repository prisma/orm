import type { Temporal } from 'temporal-spec';
import type { TemporalImplementation } from './temporal';

/**
 * The ids of the "now" generators, as contracts store them, and the values they produce. Every value reads the clock through `Date.now()` and is in UTC. A value with a time rounds down to the fraction digits it is given, so the column stores the value as written. The text values are ISO 8601, with no trailing zeros in the fraction.
 */
export const INSTANT_NOW_GENERATOR_ID = 'instantNow' as const;
export const PLAIN_DATE_TIME_NOW_GENERATOR_ID = 'plainDateTimeNow' as const;
export const PLAIN_DATE_NOW_GENERATOR_ID = 'plainDateNow' as const;
export const PLAIN_TIME_NOW_GENERATOR_ID = 'plainTimeNow' as const;
export const TIMESTAMP_STRING_NOW_GENERATOR_ID = 'timestampStringNow' as const;
export const TIMESTAMPTZ_STRING_NOW_GENERATOR_ID = 'timestamptzStringNow' as const;
export const DATE_STRING_NOW_GENERATOR_ID = 'dateStringNow' as const;
export const TIME_STRING_NOW_GENERATOR_ID = 'timeStringNow' as const;

const UTC_OFFSET = 'Z';
const MILLISECOND_DIGITS = 3;

export type GeneratorParams = Readonly<Record<string, unknown>> | undefined;

/** The generator's `precision` param, else `maxFractionDigits`. */
export function fractionDigitsOf(params: GeneratorParams, maxFractionDigits: number): number {
  const precision = params?.['precision'];
  return typeof precision === 'number' ? precision : maxFractionDigits;
}

function utcNow(fractionDigits: number): { readonly date: string; readonly time: string } {
  const iso = new Date(Date.now()).toISOString();
  const [wholeSeconds = '', fraction = ''] = iso.slice(11, -1).split('.');
  const kept = fraction.slice(0, fractionDigits).replace(/0+$/, '');
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

export function timestampStringNow(fractionDigits: number): string {
  const { date, time } = utcNow(fractionDigits);
  return `${date}T${time}`;
}

export function timestamptzStringNow(fractionDigits: number): string {
  return `${timestampStringNow(fractionDigits)}${UTC_OFFSET}`;
}

export function dateStringNow(): string {
  return utcNow(MILLISECOND_DIGITS).date;
}

export function timeStringNow(fractionDigits: number): string {
  return utcNow(fractionDigits).time;
}
