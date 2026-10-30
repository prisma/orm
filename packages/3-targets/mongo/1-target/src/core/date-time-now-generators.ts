import { TIMESTAMP_NOW_GENERATOR_ID } from '@internal/framework-components/authoring';
import * as nowValues from '@internal/type-implementations/now';
import {
  DATE_STRING_NOW_GENERATOR_ID,
  INSTANT_NOW_GENERATOR_ID,
  INSTANT_STRING_NOW_GENERATOR_ID,
  PLAIN_DATE_NOW_GENERATOR_ID,
  PLAIN_TIME_NOW_GENERATOR_ID,
  TIME_STRING_NOW_GENERATOR_ID,
} from '@internal/type-implementations/now';
import type { Temporal } from 'temporal-spec';
import {
  MONGO_DATE_CODEC_ID,
  MONGO_DATE_INSTANT_CODEC_ID,
  MONGO_DATE_INSTANT_STRING_CODEC_ID,
  MONGO_DATE_STRING_CODEC_ID,
  MONGO_DATE_TEMPORAL_CODEC_ID,
  MONGO_TIME_STRING_CODEC_ID,
  MONGO_TIME_TEMPORAL_CODEC_ID,
} from './codec-ids';
import { requireTemporal } from './require-temporal';

/** A BSON date holds milliseconds, and a time of day is stored with three fraction digits. */
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

export function instantStringNow(): string {
  return nowValues.instantStringNow(MILLISECOND_DIGITS, 'fixed');
}

export function timeStringNow(): string {
  return nowValues.timeStringNow(MILLISECOND_DIGITS, 'fixed');
}

/**
 * The MongoDB "now" generators, one per date and time codec except `mongo/date@1`, which uses the family's `timestampNow`. All read the clock through `Date.now()`, write UTC and keep milliseconds. The string generators write the text their type reads, with three fraction digits.
 */
export const mongoNowGenerators = [
  { id: INSTANT_NOW_GENERATOR_ID, generate: instantNow },
  { id: PLAIN_DATE_NOW_GENERATOR_ID, generate: plainDateNow },
  { id: PLAIN_TIME_NOW_GENERATOR_ID, generate: plainTimeNow },
  { id: INSTANT_STRING_NOW_GENERATOR_ID, generate: instantStringNow },
  { id: DATE_STRING_NOW_GENERATOR_ID, generate: nowValues.dateStringNow },
  { id: TIME_STRING_NOW_GENERATOR_ID, generate: timeStringNow },
] as const satisfies ReadonlyArray<{
  readonly id: string;
  readonly generate: () => unknown;
}>;

/** The "now" generator for each codec that has one. The `now` generator function binds it. */
export const mongoNowGeneratorIds = {
  [MONGO_DATE_CODEC_ID]: TIMESTAMP_NOW_GENERATOR_ID,
  [MONGO_DATE_INSTANT_CODEC_ID]: INSTANT_NOW_GENERATOR_ID,
  [MONGO_DATE_INSTANT_STRING_CODEC_ID]: INSTANT_STRING_NOW_GENERATOR_ID,
  [MONGO_DATE_STRING_CODEC_ID]: DATE_STRING_NOW_GENERATOR_ID,
  [MONGO_DATE_TEMPORAL_CODEC_ID]: PLAIN_DATE_NOW_GENERATOR_ID,
  [MONGO_TIME_STRING_CODEC_ID]: TIME_STRING_NOW_GENERATOR_ID,
  [MONGO_TIME_TEMPORAL_CODEC_ID]: PLAIN_TIME_NOW_GENERATOR_ID,
} as const;
