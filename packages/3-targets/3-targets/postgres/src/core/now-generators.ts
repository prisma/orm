import { TIMESTAMP_NOW_GENERATOR_ID } from '@internal/family-sql/control';
import {
  PG_TIMESTAMP_STRING_CODEC_ID,
  PG_TIMESTAMP_TEMPORAL_CODEC_ID,
  PG_TIMESTAMPTZ_DATE_CODEC_ID,
  PG_TIMESTAMPTZ_STRING_CODEC_ID,
  PG_TIMESTAMPTZ_TEMPORAL_CODEC_ID,
} from './codec-ids';
import { INSTANT_NOW_GENERATOR_ID } from './instant-now-generator';
import { PLAIN_DATE_TIME_NOW_GENERATOR_ID } from './plain-date-time-now-generator';

/** The "now" generator for each codec that has one. The `temporal` field presets read it. */
export const postgresNowGeneratorIds = {
  [PG_TIMESTAMP_TEMPORAL_CODEC_ID]: PLAIN_DATE_TIME_NOW_GENERATOR_ID,
  [PG_TIMESTAMPTZ_TEMPORAL_CODEC_ID]: INSTANT_NOW_GENERATOR_ID,
  [PG_TIMESTAMPTZ_DATE_CODEC_ID]: TIMESTAMP_NOW_GENERATOR_ID,
  [PG_TIMESTAMP_STRING_CODEC_ID]: TIMESTAMP_NOW_GENERATOR_ID,
  [PG_TIMESTAMPTZ_STRING_CODEC_ID]: TIMESTAMP_NOW_GENERATOR_ID,
} as const;

const nowGeneratorIdByCodecId: ReadonlyMap<string, string> = new Map(
  Object.entries(postgresNowGeneratorIds),
);

export function postgresNowGeneratorIdFor(codecId: string): string | undefined {
  return nowGeneratorIdByCodecId.get(codecId);
}
