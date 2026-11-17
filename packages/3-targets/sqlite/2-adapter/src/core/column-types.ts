import type { ColumnTypeDescriptor } from '@internal/framework-components/codec';
import { requireSqlExpression, type SqlExpression } from '@internal/sql-contract/sql-expression';
import {
  SQL_RAW_CODEC_ID,
  SQLITE_BIGINT_CODEC_ID,
  SQLITE_BLOB_CODEC_ID,
  SQLITE_DATE_STRING_CODEC_ID,
  SQLITE_DATE_TEMPORAL_CODEC_ID,
  SQLITE_DATETIME_CODEC_ID,
  SQLITE_DATETIME_STRING_CODEC_ID,
  SQLITE_DATETIME_TEMPORAL_CODEC_ID,
  SQLITE_DURATION_STRING_CODEC_ID,
  SQLITE_INTEGER_CODEC_ID,
  SQLITE_JSON_CODEC_ID,
  SQLITE_REAL_CODEC_ID,
  SQLITE_TEXT_CODEC_ID,
  SQLITE_TIME_STRING_CODEC_ID,
  SQLITE_TIME_TEMPORAL_CODEC_ID,
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

export const datetimeTemporalColumn = {
  codecId: SQLITE_DATETIME_TEMPORAL_CODEC_ID,
} as const;

export const datetimeStringColumn = {
  codecId: SQLITE_DATETIME_STRING_CODEC_ID,
} as const;

export const dateStringColumn = {
  codecId: SQLITE_DATE_STRING_CODEC_ID,
} as const;

export const dateTemporalColumn = {
  codecId: SQLITE_DATE_TEMPORAL_CODEC_ID,
} as const;

export const timeStringColumn = {
  codecId: SQLITE_TIME_STRING_CODEC_ID,
} as const;

export const timeTemporalColumn = {
  codecId: SQLITE_TIME_TEMPORAL_CODEC_ID,
} as const;

export const durationStringColumn = {
  codecId: SQLITE_DURATION_STRING_CODEC_ID,
} as const;

export const jsonColumn = {
  codecId: SQLITE_JSON_CODEC_ID,
} as const;

export const bigintColumn = {
  codecId: SQLITE_BIGINT_CODEC_ID,
} as const;

/** A column of a type no other column type covers, named exactly as the database catalog prints it, such as ``rawColumn(sql`tsvector`)`` (ADR 273). Its values are typed `unknown`. */
export function rawColumn(definition: SqlExpression): ColumnTypeDescriptor<
  typeof SQL_RAW_CODEC_ID
> & {
  readonly typeParams: { readonly sql: string };
} {
  const { text } = requireSqlExpression(definition, 'rawColumn(...)');
  return { codecId: SQL_RAW_CODEC_ID, typeParams: { sql: text } } as const;
}
