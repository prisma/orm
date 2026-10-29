import type { MutationDefaultGeneratorDescriptor } from '@internal/framework-components/control';
import type { Temporal } from 'temporal-spec';
import { requireTemporal } from './require-temporal';

/**
 * The Postgres "now" generators, one per date and time codec except `pg/timestamptz-date@1` and `pg/timestamp-date@1`, which use the SQL family's `timestampNow`. All read the clock through `Date.now()` and write UTC. The time and timestamp generators round down to their `precision` param, so the column stores the value as written. The string generators are named after the codec they serve and write the codec's stored form (ADR 254, "Date and time types") in UTC, with milliseconds and no trailing zeros in the fraction.
 */
export const INSTANT_NOW_GENERATOR_ID = 'instantNow' as const;
export const PLAIN_DATE_TIME_NOW_GENERATOR_ID = 'plainDateTimeNow' as const;
export const PLAIN_DATE_NOW_GENERATOR_ID = 'plainDateNow' as const;
export const PLAIN_TIME_NOW_GENERATOR_ID = 'plainTimeNow' as const;
export const TIMESTAMP_STRING_NOW_GENERATOR_ID = 'timestampStringNow' as const;
export const TIMESTAMPTZ_STRING_NOW_GENERATOR_ID = 'timestamptzStringNow' as const;
export const DATE_STRING_NOW_GENERATOR_ID = 'dateStringNow' as const;
export const TIME_STRING_NOW_GENERATOR_ID = 'timeStringNow' as const;
export const TIMETZ_NOW_GENERATOR_ID = 'timetzNow' as const;

const UTC_OFFSET = 'Z';
const MAX_TIME_PRECISION = 6;
const MILLISECOND_DIGITS = 3;

type GeneratorParams = Readonly<Record<string, unknown>> | undefined;

function fractionDigitsOf(params: GeneratorParams): number {
  const precision = params?.['precision'];
  return typeof precision === 'number' ? precision : MAX_TIME_PRECISION;
}

function utcNow(fractionDigits = MAX_TIME_PRECISION): {
  readonly date: string;
  readonly time: string;
} {
  const iso = new Date(Date.now()).toISOString();
  const [wholeSeconds = '', fraction = ''] = iso.slice(11, -1).split('.');
  const kept = fraction.slice(0, fractionDigits).replace(/0+$/, '');
  return {
    date: iso.slice(0, 10),
    time: kept === '' ? wholeSeconds : `${wholeSeconds}.${kept}`,
  };
}

/** Rounds down, so PostgreSQL stores the value without rounding it up, which can reach `24:00:00`. */
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

function epochMillisecondsNow(fractionDigits = MAX_TIME_PRECISION): number {
  const now = Date.now();
  if (fractionDigits >= MILLISECOND_DIGITS) return now;
  const step = 10 ** (MILLISECOND_DIGITS - Math.max(fractionDigits, 0));
  return Math.floor(now / step) * step;
}

function utcInstantNow(generatorId: string, fractionDigits?: number): Temporal.Instant {
  return requireTemporal({ generatorId }).Instant.fromEpochMilliseconds(
    epochMillisecondsNow(fractionDigits),
  );
}

function utcDateTimeNow(generatorId: string, fractionDigits?: number): Temporal.ZonedDateTime {
  return utcInstantNow(generatorId, fractionDigits).toZonedDateTimeISO('UTC');
}

export function instantNow(params?: GeneratorParams): Temporal.Instant {
  return utcInstantNow(INSTANT_NOW_GENERATOR_ID, fractionDigitsOf(params));
}

export function plainDateTimeNow(params?: GeneratorParams): Temporal.PlainDateTime {
  return utcDateTimeNow(
    PLAIN_DATE_TIME_NOW_GENERATOR_ID,
    fractionDigitsOf(params),
  ).toPlainDateTime();
}

export function plainDateNow(): Temporal.PlainDate {
  return utcDateTimeNow(PLAIN_DATE_NOW_GENERATOR_ID).toPlainDate();
}

export function plainTimeNow(params?: GeneratorParams): Temporal.PlainTime {
  return truncateTime(
    utcDateTimeNow(PLAIN_TIME_NOW_GENERATOR_ID).toPlainTime(),
    fractionDigitsOf(params),
  );
}

export function timestampStringNow(params?: GeneratorParams): string {
  const { date, time } = utcNow(fractionDigitsOf(params));
  return `${date}T${time}`;
}

export function timestamptzStringNow(params?: GeneratorParams): string {
  return `${timestampStringNow(params)}${UTC_OFFSET}`;
}

export function dateStringNow(): string {
  return utcNow().date;
}

export function timeStringNow(params?: GeneratorParams): string {
  return utcNow(fractionDigitsOf(params)).time;
}

export function timetzNow(params?: GeneratorParams): string {
  return `${timeStringNow(params)}${UTC_OFFSET}`;
}

export const postgresNowGenerators = [
  { id: INSTANT_NOW_GENERATOR_ID, generate: instantNow },
  { id: PLAIN_DATE_TIME_NOW_GENERATOR_ID, generate: plainDateTimeNow },
  { id: PLAIN_DATE_NOW_GENERATOR_ID, generate: plainDateNow },
  { id: PLAIN_TIME_NOW_GENERATOR_ID, generate: plainTimeNow },
  { id: TIMESTAMP_STRING_NOW_GENERATOR_ID, generate: timestampStringNow },
  { id: TIMESTAMPTZ_STRING_NOW_GENERATOR_ID, generate: timestamptzStringNow },
  { id: DATE_STRING_NOW_GENERATOR_ID, generate: dateStringNow },
  { id: TIME_STRING_NOW_GENERATOR_ID, generate: timeStringNow },
  { id: TIMETZ_NOW_GENERATOR_ID, generate: timetzNow },
] as const satisfies ReadonlyArray<{
  readonly id: string;
  readonly generate: (params?: GeneratorParams) => unknown;
}>;

export function postgresNowGeneratorControlDescriptors(): readonly MutationDefaultGeneratorDescriptor[] {
  return postgresNowGenerators.map(({ id }) => ({ id }));
}
