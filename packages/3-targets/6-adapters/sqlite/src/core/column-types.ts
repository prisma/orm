import {
  SQLITE_BIGINT_CODEC_ID,
  SQLITE_BLOB_CODEC_ID,
  SQLITE_DATETIME_CODEC_ID,
  SQLITE_INTEGER_CODEC_ID,
  SQLITE_JSON_CODEC_ID,
  SQLITE_REAL_CODEC_ID,
  SQLITE_TEXT_CODEC_ID,
} from '@internal/target-sqlite/codec-ids';

export const textColumn = {
  codecId: SQLITE_TEXT_CODEC_ID,
} as const;

export const integerColumn = {
  codecId: SQLITE_INTEGER_CODEC_ID,
} as const;

export const realColumn = {
  codecId: SQLITE_REAL_CODEC_ID,
} as const;

export const blobColumn = {
  codecId: SQLITE_BLOB_CODEC_ID,
} as const;

export const datetimeColumn = {
  codecId: SQLITE_DATETIME_CODEC_ID,
} as const;

export const jsonColumn = {
  codecId: SQLITE_JSON_CODEC_ID,
} as const;

export const bigintColumn = {
  codecId: SQLITE_BIGINT_CODEC_ID,
} as const;
