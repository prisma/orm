import * as nowValues from '@internal/type-implementations/now';
import {
  DATE_STRING_NOW_GENERATOR_ID,
  INSTANT_NOW_GENERATOR_ID,
  PLAIN_DATE_NOW_GENERATOR_ID,
  PLAIN_TIME_NOW_GENERATOR_ID,
  TIME_STRING_NOW_GENERATOR_ID,
  TIMESTAMPTZ_STRING_NOW_GENERATOR_ID,
} from '@internal/type-implementations/now';
import type { Temporal } from 'temporal-spec';
import { sqliteDatetimeText, sqliteTimeText } from './data-types';
import { requireTemporal } from './require-temporal';

/** SQLite's date and time types hold milliseconds. */
const MILLISECOND_DIGITS = 3;

export function instantNow(): Temporal.Instant {
  return nowValues.instantNow(
    requireTemporal({ generatorId: INSTANT_NOW_GENERATOR_ID }),
    MILLISECOND_DIGITS,
  );
}

export function plainDateNow(): Temporal.PlainDate {
  return nowValues.plainDateNow(requireTemporal({ generatorId: PLAIN_DATE_NOW_GENERATOR_ID }));
}

export function plainTimeNow(): Temporal.PlainTime {
  return nowValues.plainTimeNow(
    requireTemporal({ generatorId: PLAIN_TIME_NOW_GENERATOR_ID }),
    MILLISECOND_DIGITS,
  );
}

export function timestamptzStringNow(): string {
  return sqliteDatetimeText(nowValues.timestamptzStringNow(MILLISECOND_DIGITS));
}

export function timeStringNow(): string {
  return sqliteTimeText(nowValues.timeStringNow(MILLISECOND_DIGITS));
}

/**
 * The SQLite "now" generators, one per date and time codec except `sqlite/datetime@1`, which uses the SQL family's `timestampNow`. All read the clock through `Date.now()`, write UTC and keep milliseconds, which every SQLite date and time type holds. The string generators write the text their type stores.
 */
export const sqliteNowGenerators = [
  { id: INSTANT_NOW_GENERATOR_ID, generate: instantNow },
  { id: PLAIN_DATE_NOW_GENERATOR_ID, generate: plainDateNow },
  { id: PLAIN_TIME_NOW_GENERATOR_ID, generate: plainTimeNow },
  { id: TIMESTAMPTZ_STRING_NOW_GENERATOR_ID, generate: timestamptzStringNow },
  { id: DATE_STRING_NOW_GENERATOR_ID, generate: nowValues.dateStringNow },
  { id: TIME_STRING_NOW_GENERATOR_ID, generate: timeStringNow },
] as const satisfies ReadonlyArray<{
  readonly id: string;
  readonly generate: () => unknown;
}>;
