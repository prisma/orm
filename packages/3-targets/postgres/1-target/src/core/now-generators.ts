import { TIMESTAMP_NOW_GENERATOR_ID } from '@internal/framework-components/authoring';
import type { GeneratorFunctionContribution } from '@internal/framework-components/components';
import { singleGeneratorBinding } from '@internal/framework-components/components';
import {
  PG_DATE_STRING_CODEC_ID,
  PG_DATE_TEMPORAL_CODEC_ID,
  PG_TIME_STRING_CODEC_ID,
  PG_TIME_TEMPORAL_CODEC_ID,
  PG_TIMESTAMP_DATE_CODEC_ID,
  PG_TIMESTAMP_INSTANT_CODEC_ID,
  PG_TIMESTAMP_STRING_CODEC_ID,
  PG_TIMESTAMP_TEMPORAL_CODEC_ID,
  PG_TIMESTAMPTZ_DATE_CODEC_ID,
  PG_TIMESTAMPTZ_STRING_CODEC_ID,
  PG_TIMESTAMPTZ_TEMPORAL_CODEC_ID,
  PG_TIMETZ_CODEC_ID,
} from './codec-ids';
import {
  DATE_STRING_NOW_GENERATOR_ID,
  INSTANT_NOW_GENERATOR_ID,
  PLAIN_DATE_NOW_GENERATOR_ID,
  PLAIN_DATE_TIME_NOW_GENERATOR_ID,
  PLAIN_TIME_NOW_GENERATOR_ID,
  TIME_STRING_NOW_GENERATOR_ID,
  TIMESTAMP_STRING_NOW_GENERATOR_ID,
  TIMESTAMPTZ_STRING_NOW_GENERATOR_ID,
  TIMETZ_NOW_GENERATOR_ID,
} from './date-time-now-generators';

/** The "now" generator for each codec that has one. The `now` generator function binds it. */
export const postgresNowGeneratorIds = {
  [PG_DATE_TEMPORAL_CODEC_ID]: PLAIN_DATE_NOW_GENERATOR_ID,
  [PG_DATE_STRING_CODEC_ID]: DATE_STRING_NOW_GENERATOR_ID,
  [PG_TIME_TEMPORAL_CODEC_ID]: PLAIN_TIME_NOW_GENERATOR_ID,
  [PG_TIME_STRING_CODEC_ID]: TIME_STRING_NOW_GENERATOR_ID,
  [PG_TIMETZ_CODEC_ID]: TIMETZ_NOW_GENERATOR_ID,
  [PG_TIMESTAMP_TEMPORAL_CODEC_ID]: PLAIN_DATE_TIME_NOW_GENERATOR_ID,
  [PG_TIMESTAMP_STRING_CODEC_ID]: TIMESTAMP_STRING_NOW_GENERATOR_ID,
  [PG_TIMESTAMPTZ_TEMPORAL_CODEC_ID]: INSTANT_NOW_GENERATOR_ID,
  [PG_TIMESTAMPTZ_STRING_CODEC_ID]: TIMESTAMPTZ_STRING_NOW_GENERATOR_ID,
  [PG_TIMESTAMPTZ_DATE_CODEC_ID]: TIMESTAMP_NOW_GENERATOR_ID,
  [PG_TIMESTAMP_DATE_CODEC_ID]: TIMESTAMP_NOW_GENERATOR_ID,
  [PG_TIMESTAMP_INSTANT_CODEC_ID]: INSTANT_NOW_GENERATOR_ID,
} as const;

const nowGeneratorIdByCodecId: ReadonlyMap<string, string> = new Map(
  Object.entries(postgresNowGeneratorIds),
);

export function postgresNowGeneratorIdFor(codecId: string): string | undefined {
  return nowGeneratorIdByCodecId.get(codecId);
}

/** The codecs whose "now" generator takes the column's precision and rounds down to it, so PostgreSQL stores the value the client holds rather than rounding it up, which for a time can reach `24:00:00`. */
export const postgresNowGeneratorTakesPrecision = {
  [PG_TIME_TEMPORAL_CODEC_ID]: true,
  [PG_TIME_STRING_CODEC_ID]: true,
  [PG_TIMETZ_CODEC_ID]: true,
  [PG_TIMESTAMP_STRING_CODEC_ID]: true,
  [PG_TIMESTAMPTZ_STRING_CODEC_ID]: true,
  [PG_TIMESTAMPTZ_DATE_CODEC_ID]: true,
  [PG_TIMESTAMP_DATE_CODEC_ID]: true,
  [PG_TIMESTAMP_TEMPORAL_CODEC_ID]: true,
  [PG_TIMESTAMPTZ_TEMPORAL_CODEC_ID]: true,
  [PG_TIMESTAMP_INSTANT_CODEC_ID]: true,
} as const;

/** The `now` generator function bound to each Postgres date and time codec, with the column's precision on the codecs that take it. */
export const postgresNowGeneratorFunction: GeneratorFunctionContribution = {
  name: 'now',
  bindings: Object.entries(postgresNowGeneratorIds).map(([codecId, generatorId]) =>
    singleGeneratorBinding({
      codecIds: [codecId],
      generatorId,
      paramsFromField: (column) => {
        const precision = column.typeParams?.['precision'];
        return Object.hasOwn(postgresNowGeneratorTakesPrecision, codecId) &&
          typeof precision === 'number'
          ? { precision }
          : undefined;
      },
    }),
  ),
};
