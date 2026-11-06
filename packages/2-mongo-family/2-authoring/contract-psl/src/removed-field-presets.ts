import {
  type RemovedFieldPresets,
  removedPresetWithPhases,
  removedPresetWrittenAs,
} from '@internal/psl-parser/interpret';

const MONGO_DATE_CODEC_ID = 'mongo/date@1';

/** The MongoDB family's removed field presets; each applies only where its rewrite's type stores a Mongo date. */
export const removedMongoFieldPresets: RemovedFieldPresets = {
  'temporal.createdAt': removedPresetWrittenAs('temporal.CreatedAt', MONGO_DATE_CODEC_ID),
  'temporal.updatedAt': removedPresetWrittenAs('temporal.UpdatedAt', MONGO_DATE_CODEC_ID),
  'temporal.timestamp': removedPresetWithPhases('Date', MONGO_DATE_CODEC_ID, false),
};
