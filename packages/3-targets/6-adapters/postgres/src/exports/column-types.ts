/**
 * Column type descriptors for Postgres adapter.
 *
 * These descriptors provide both codecId and nativeType for use in contract authoring. They are derived from the same source of truth as codec definitions and manifests.
 */

import type { ColumnTypeDescriptor } from '@internal/framework-components/codec';
import {
  PG_BIT_CODEC_ID,
  PG_BOOL_CODEC_ID,
  PG_BYTEA_CODEC_ID,
  PG_DATE_STRING_CODEC_ID,
  PG_DATE_TEMPORAL_CODEC_ID,
  PG_FLOAT4_CODEC_ID,
  PG_FLOAT8_CODEC_ID,
  PG_INT2_CODEC_ID,
  PG_INT4_CODEC_ID,
  PG_INT8_CODEC_ID,
  PG_INTERVAL_CODEC_ID,
  PG_JSON_CODEC_ID,
  PG_JSONB_CODEC_ID,
  PG_NUMERIC_CODEC_ID,
  PG_TEXT_CODEC_ID,
  PG_TIME_STRING_CODEC_ID,
  PG_TIME_TEMPORAL_CODEC_ID,
  PG_TIMESTAMP_STRING_CODEC_ID,
  PG_TIMESTAMP_TEMPORAL_CODEC_ID,
  PG_TIMESTAMPTZ_STRING_CODEC_ID,
  PG_TIMESTAMPTZ_TEMPORAL_CODEC_ID,
  PG_TIMETZ_CODEC_ID,
  PG_VARBIT_CODEC_ID,
  SQL_CHAR_CODEC_ID,
  SQL_VARCHAR_CODEC_ID,
} from '@internal/target-postgres/codec-ids';

export const textColumn = {
  codecId: PG_TEXT_CODEC_ID,
  nativeType: 'text',
} as const satisfies ColumnTypeDescriptor;

export function charColumn(length: number): ColumnTypeDescriptor & {
  readonly typeParams: { readonly length: number };
} {
  return {
    codecId: SQL_CHAR_CODEC_ID,
    nativeType: 'character',
    typeParams: { length },
  } as const;
}

export function varcharColumn(length: number): ColumnTypeDescriptor & {
  readonly typeParams: { readonly length: number };
} {
  return {
    codecId: SQL_VARCHAR_CODEC_ID,
    nativeType: 'character varying',
    typeParams: { length },
  } as const;
}

export const int4Column = {
  codecId: PG_INT4_CODEC_ID,
  nativeType: 'int4',
} as const satisfies ColumnTypeDescriptor;

export const int2Column = {
  codecId: PG_INT2_CODEC_ID,
  nativeType: 'int2',
} as const satisfies ColumnTypeDescriptor;

export const int8Column = {
  codecId: PG_INT8_CODEC_ID,
  nativeType: 'int8',
} as const satisfies ColumnTypeDescriptor;

export const float4Column = {
  codecId: PG_FLOAT4_CODEC_ID,
  nativeType: 'float4',
} as const satisfies ColumnTypeDescriptor;

export const float8Column = {
  codecId: PG_FLOAT8_CODEC_ID,
  nativeType: 'float8',
} as const satisfies ColumnTypeDescriptor;

export function numericColumn(
  precision: number,
  scale?: number,
): ColumnTypeDescriptor & {
  readonly typeParams: { readonly precision: number; readonly scale?: number };
} {
  return {
    codecId: PG_NUMERIC_CODEC_ID,
    nativeType: 'numeric',
    typeParams: scale === undefined ? { precision } : { precision, scale },
  } as const;
}

/**
 * The representation-explicit temporal descriptors. Both halves declare the same column; they differ
 * only in what a read hands back — a `Temporal.*` value, or PostgreSQL's own text for the values
 * Temporal cannot express.
 */
export const dateTemporalColumn = {
  codecId: PG_DATE_TEMPORAL_CODEC_ID,
  nativeType: 'date',
} as const satisfies ColumnTypeDescriptor;

export const dateStringColumn = {
  codecId: PG_DATE_STRING_CODEC_ID,
  nativeType: 'date',
} as const satisfies ColumnTypeDescriptor;

export const timestampTemporalColumn = {
  codecId: PG_TIMESTAMP_TEMPORAL_CODEC_ID,
  nativeType: 'timestamp',
} as const satisfies ColumnTypeDescriptor;

export const timestampStringColumn = {
  codecId: PG_TIMESTAMP_STRING_CODEC_ID,
  nativeType: 'timestamp',
} as const satisfies ColumnTypeDescriptor;

export const timestamptzTemporalColumn = {
  codecId: PG_TIMESTAMPTZ_TEMPORAL_CODEC_ID,
  nativeType: 'timestamptz',
} as const satisfies ColumnTypeDescriptor;

export const timestamptzStringColumn = {
  codecId: PG_TIMESTAMPTZ_STRING_CODEC_ID,
  nativeType: 'timestamptz',
} as const satisfies ColumnTypeDescriptor;

export const timeTemporalColumn = {
  codecId: PG_TIME_TEMPORAL_CODEC_ID,
  nativeType: 'time',
} as const satisfies ColumnTypeDescriptor;

export const timeStringColumn = {
  codecId: PG_TIME_STRING_CODEC_ID,
  nativeType: 'time',
} as const satisfies ColumnTypeDescriptor;

export function timetzColumn(precision?: number): ColumnTypeDescriptor & {
  readonly typeParams?: { readonly precision: number };
} {
  return {
    codecId: PG_TIMETZ_CODEC_ID,
    nativeType: 'timetz',
    ...(precision === undefined ? {} : { typeParams: { precision } }),
  } as const;
}

export const boolColumn = {
  codecId: PG_BOOL_CODEC_ID,
  nativeType: 'bool',
} as const satisfies ColumnTypeDescriptor;

export function bitColumn(length: number): ColumnTypeDescriptor & {
  readonly typeParams: { readonly length: number };
} {
  return {
    codecId: PG_BIT_CODEC_ID,
    nativeType: 'bit',
    typeParams: { length },
  } as const;
}

export function varbitColumn(length: number): ColumnTypeDescriptor & {
  readonly typeParams: { readonly length: number };
} {
  return {
    codecId: PG_VARBIT_CODEC_ID,
    nativeType: 'bit varying',
    typeParams: { length },
  } as const;
}

/**
 * Postgres `bytea` column descriptor — variable-length binary string.
 *
 * Round-trips as `Uint8Array` on the JS side. The pg wire-protocol text encoding (`\x` followed by hex-encoded bytes, canonical for Postgres ≥ 9.0) and binary encoding are both handled by the underlying driver; the codec only normalizes the JS-side representation to a plain `Uint8Array` view.
 */
export const byteaColumn = {
  codecId: PG_BYTEA_CODEC_ID,
  nativeType: 'bytea',
} as const satisfies ColumnTypeDescriptor;

export function intervalColumn(precision?: number): ColumnTypeDescriptor & {
  readonly typeParams?: { readonly precision: number };
} {
  return {
    codecId: PG_INTERVAL_CODEC_ID,
    nativeType: 'interval',
    ...(precision === undefined ? {} : { typeParams: { precision } }),
  } as const;
}

/**
 * Postgres `json` column descriptor — untyped raw JSON.
 *
 * For schema-typed JSON columns, use the per-library extension package (`@internal/extension-arktype-json` ships `arktypeJson(schema)` for arktype). The schema-accepting `json(schema)` / `jsonb(schema)` overloads previously shipped from this module retired in Phase C of the codec-registry-unification project — see spec § AC-7.
 */
export const jsonColumn = {
  codecId: PG_JSON_CODEC_ID,
  nativeType: 'json',
} as const satisfies ColumnTypeDescriptor;

/**
 * Postgres `jsonb` column descriptor — untyped raw JSONB. Same retirement note as {@link jsonColumn}.
 */
export const jsonbColumn = {
  codecId: PG_JSONB_CODEC_ID,
  nativeType: 'jsonb',
} as const satisfies ColumnTypeDescriptor;
