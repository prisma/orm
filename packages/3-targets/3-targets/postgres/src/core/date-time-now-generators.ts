import type { MutationDefaultGeneratorDescriptor } from '@internal/framework-components/control';
import { requireTemporal } from './require-temporal';

/**
 * The Postgres "now" generators, one per date and time codec except `pg/timestamptz-date@1`, which uses the framework's `timestampNow`. All read the clock through `Date.now()` and write UTC. The time generators round down to their `precision` param. The string generators are named after the codec they serve and write the text PostgreSQL prints in a UTC session, with milliseconds and no trailing zeros in the fraction.
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

const UTC_OFFSET = '+00';
const MAX_TIME_PRECISION = 6;

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

function utcDateTimeNow(generatorId: string): Temporal.ZonedDateTime {
  return requireTemporal({ generatorId })
    .Instant.fromEpochMilliseconds(Date.now())
    .toZonedDateTimeISO('UTC');
}

export function instantNow(): Temporal.Instant {
  return requireTemporal({ generatorId: INSTANT_NOW_GENERATOR_ID }).Instant.fromEpochMilliseconds(
    Date.now(),
  );
}

export function plainDateTimeNow(): Temporal.PlainDateTime {
  return utcDateTimeNow(PLAIN_DATE_TIME_NOW_GENERATOR_ID).toPlainDateTime();
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

export function timestampStringNow(): string {
  const { date, time } = utcNow();
  return `${date} ${time}`;
}

export function timestamptzStringNow(): string {
  return `${timestampStringNow()}${UTC_OFFSET}`;
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
  return postgresNowGenerators.map(({ id }) => ({
    id,
    buildPhases: () => ({
      onCreate: { kind: 'generator', id },
      onUpdate: { kind: 'generator', id },
    }),
  }));
}
