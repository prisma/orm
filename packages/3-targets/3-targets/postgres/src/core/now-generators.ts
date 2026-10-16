import type { ExecutionMutationDefaultValue } from '@internal/contract/types';
import { TIMESTAMP_NOW_GENERATOR_ID } from '@internal/framework-components/authoring';
import {
  PG_DATE_STRING_CODEC_ID,
  PG_DATE_TEMPORAL_CODEC_ID,
  PG_TIME_STRING_CODEC_ID,
  PG_TIME_TEMPORAL_CODEC_ID,
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

/** The "now" generator for each codec that has one. The `temporal` field presets read it. */
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
} as const;

const nowGeneratorIdByCodecId: ReadonlyMap<string, string> = new Map(
  Object.entries(postgresNowGeneratorIds),
);

export function postgresNowGeneratorIdFor(codecId: string): string | undefined {
  return nowGeneratorIdByCodecId.get(codecId);
}

/** The codecs whose "now" generator takes the column's precision, so that it rounds down where PostgreSQL would round a time up to `24:00:00`. */
export const postgresNowGeneratorTakesPrecision = {
  [PG_TIME_TEMPORAL_CODEC_ID]: true,
  [PG_TIME_STRING_CODEC_ID]: true,
  [PG_TIMETZ_CODEC_ID]: true,
} as const;

/** The "now" generator for a column, with the column's precision as its param when it takes one; `undefined` when the codec has none. */
export function postgresNowGeneratorFor(column: {
  readonly codecId: string;
  readonly typeParams?: Readonly<Record<string, unknown>> | undefined;
}): ExecutionMutationDefaultValue | undefined {
  const id = postgresNowGeneratorIdFor(column.codecId);
  if (id === undefined) return undefined;
  const precision = column.typeParams?.['precision'];
  return Object.hasOwn(postgresNowGeneratorTakesPrecision, column.codecId) &&
    typeof precision === 'number'
    ? { kind: 'generator', id, params: { precision } }
    : { kind: 'generator', id };
}
