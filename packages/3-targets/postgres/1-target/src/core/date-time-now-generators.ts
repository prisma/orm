import type { MutationDefaultGeneratorDescriptor } from '@internal/framework-components/control';
import * as nowValues from '@internal/type-implementations/now';
import {
  DATE_STRING_NOW_GENERATOR_ID,
  fractionDigitsOf,
  type GeneratorParams,
  INSTANT_NOW_GENERATOR_ID,
  PLAIN_DATE_NOW_GENERATOR_ID,
  PLAIN_DATE_TIME_NOW_GENERATOR_ID,
  PLAIN_TIME_NOW_GENERATOR_ID,
  TIME_STRING_NOW_GENERATOR_ID,
} from '@internal/type-implementations/now';
import type { Temporal } from 'temporal-spec';
import { requireTemporal } from './require-temporal';

export const TIMESTAMP_STRING_NOW_GENERATOR_ID = 'timestampStringNow' as const;
export const TIMESTAMPTZ_STRING_NOW_GENERATOR_ID = 'timestamptzStringNow' as const;
export const TIMETZ_NOW_GENERATOR_ID = 'timetzNow' as const;

const UTC_OFFSET = 'Z';
const MAX_TIME_PRECISION = 6;

function precisionOf(params: GeneratorParams): number {
  return fractionDigitsOf(params, MAX_TIME_PRECISION);
}

export function instantNow(params?: GeneratorParams): Temporal.Instant {
  return nowValues.instantNow(
    requireTemporal({ generatorId: INSTANT_NOW_GENERATOR_ID }),
    precisionOf(params),
  );
}

export function plainDateTimeNow(params?: GeneratorParams): Temporal.PlainDateTime {
  return nowValues.plainDateTimeNow(
    requireTemporal({ generatorId: PLAIN_DATE_TIME_NOW_GENERATOR_ID }),
    precisionOf(params),
  );
}

export function plainDateNow(): Temporal.PlainDate {
  return nowValues.plainDateNow(requireTemporal({ generatorId: PLAIN_DATE_NOW_GENERATOR_ID }));
}

export function plainTimeNow(params?: GeneratorParams): Temporal.PlainTime {
  return nowValues.plainTimeNow(
    requireTemporal({ generatorId: PLAIN_TIME_NOW_GENERATOR_ID }),
    precisionOf(params),
  );
}

export function timestampStringNow(params?: GeneratorParams): string {
  return nowValues.dateTimeStringNow(precisionOf(params), 'trimmed');
}

export function timestamptzStringNow(params?: GeneratorParams): string {
  return nowValues.instantStringNow(precisionOf(params), 'trimmed');
}

export function timeStringNow(params?: GeneratorParams): string {
  return nowValues.timeStringNow(precisionOf(params), 'trimmed');
}

export function timetzNow(params?: GeneratorParams): string {
  return `${timeStringNow(params)}${UTC_OFFSET}`;
}

/**
 * The Postgres "now" generators, one per date and time codec except `pg/timestamptz-date@1` and `pg/timestamp-date@1`, which use the SQL family's `timestampNow`. All read the clock through `Date.now()` and write UTC. The time and timestamp generators round down to their `precision` param, so the column stores the value as written. The string generators are named after the codec they serve and write the codec's stored form (ADR 254, "Date and time types") in UTC, with milliseconds and no trailing zeros in the fraction.
 */
export const postgresNowGenerators = [
  { id: INSTANT_NOW_GENERATOR_ID, generate: instantNow },
  { id: PLAIN_DATE_TIME_NOW_GENERATOR_ID, generate: plainDateTimeNow },
  { id: PLAIN_DATE_NOW_GENERATOR_ID, generate: plainDateNow },
  { id: PLAIN_TIME_NOW_GENERATOR_ID, generate: plainTimeNow },
  { id: TIMESTAMP_STRING_NOW_GENERATOR_ID, generate: timestampStringNow },
  { id: TIMESTAMPTZ_STRING_NOW_GENERATOR_ID, generate: timestamptzStringNow },
  { id: DATE_STRING_NOW_GENERATOR_ID, generate: nowValues.dateStringNow },
  { id: TIME_STRING_NOW_GENERATOR_ID, generate: timeStringNow },
  { id: TIMETZ_NOW_GENERATOR_ID, generate: timetzNow },
] as const satisfies ReadonlyArray<{
  readonly id: string;
  readonly generate: (params?: GeneratorParams) => unknown;
}>;

export function postgresNowGeneratorControlDescriptors(): readonly MutationDefaultGeneratorDescriptor[] {
  return postgresNowGenerators.map(({ id }) => ({ id }));
}
