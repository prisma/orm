import * as nowValues from '@internal/type-implementations/now';
import {
  DATE_STRING_NOW_GENERATOR_ID,
  fractionDigitsOf,
  type GeneratorParams,
  INSTANT_NOW_GENERATOR_ID,
  INSTANT_STRING_NOW_GENERATOR_ID,
  PLAIN_DATE_NOW_GENERATOR_ID,
  PLAIN_TIME_NOW_GENERATOR_ID,
  TIME_STRING_NOW_GENERATOR_ID,
} from '@internal/type-implementations/now';
import type { Temporal } from 'temporal-spec';
import { requireTemporal } from './require-temporal';

/** The fraction digits of a bare `datetime`, `timestamp` or `time`. */
const BARE_TYPE_FRACTION_DIGITS = 0;

function fractionDigits(params: GeneratorParams): number {
  return fractionDigitsOf(params, BARE_TYPE_FRACTION_DIGITS);
}

export function instantNow(params?: GeneratorParams): Temporal.Instant {
  return nowValues.instantNow(
    requireTemporal({ generatorId: INSTANT_NOW_GENERATOR_ID }),
    fractionDigits(params),
  );
}

export function plainDateNow(): Temporal.PlainDate {
  return nowValues.plainDateNow(requireTemporal({ generatorId: PLAIN_DATE_NOW_GENERATOR_ID }));
}

export function plainTimeNow(params?: GeneratorParams): Temporal.PlainTime {
  return nowValues.plainTimeNow(
    requireTemporal({ generatorId: PLAIN_TIME_NOW_GENERATOR_ID }),
    fractionDigits(params),
  );
}

export function instantStringNow(params?: GeneratorParams): string {
  return nowValues.instantStringNow(fractionDigits(params), 'trimmed');
}

export function timeStringNow(params?: GeneratorParams): string {
  return nowValues.timeStringNow(fractionDigits(params), 'trimmed');
}

/**
 * The MySQL "now" generators, one per date and time codec except `mysql/datetime@1` and `mysql/timestamp-date@1`, which use the SQL family's `timestampNow`. All read the clock through `Date.now()` and write UTC. Each rounds down to the column's `precision` param, so MySQL, which rounds a value to the column's fraction digits, stores the value the client holds rather than rounding it up. The string generators write the text their codec reads, with no trailing zeros in the fraction.
 */
export const mysqlNowGenerators = [
  { id: INSTANT_NOW_GENERATOR_ID, generate: instantNow },
  { id: PLAIN_DATE_NOW_GENERATOR_ID, generate: plainDateNow },
  { id: PLAIN_TIME_NOW_GENERATOR_ID, generate: plainTimeNow },
  { id: INSTANT_STRING_NOW_GENERATOR_ID, generate: instantStringNow },
  { id: DATE_STRING_NOW_GENERATOR_ID, generate: nowValues.dateStringNow },
  { id: TIME_STRING_NOW_GENERATOR_ID, generate: timeStringNow },
] as const satisfies ReadonlyArray<{
  readonly id: string;
  readonly generate: (params?: GeneratorParams) => unknown;
}>;
