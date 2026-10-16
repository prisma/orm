/**
 * Column type descriptors for Postgres adapter.
 *
 * These descriptors provide the codec id for use in contract authoring. They are derived from the same source of truth as codec definitions and manifests.
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
  PG_TIMESTAMPTZ_DATE_CODEC_ID,
  PG_TIMESTAMPTZ_STRING_CODEC_ID,
  PG_TIMESTAMPTZ_TEMPORAL_CODEC_ID,
  PG_TIMETZ_CODEC_ID,
  PG_VARBIT_CODEC_ID,
  SQL_CHAR_CODEC_ID,
  SQL_RAW_CODEC_ID,
  SQL_VARCHAR_CODEC_ID,
} from '@internal/target-postgres/codec-ids';

export const textColumn = {
  codecId: PG_TEXT_CODEC_ID,
} as const satisfies ColumnTypeDescriptor;

export function charColumn<const Length extends number>(
  length: Length,
): ColumnTypeDescriptor<typeof SQL_CHAR_CODEC_ID> & {
  readonly typeParams: { readonly length: Length };
};
export function charColumn(length: number): ColumnTypeDescriptor<typeof SQL_CHAR_CODEC_ID> & {
  readonly typeParams: { readonly length: number };
} {
  return {
    codecId: SQL_CHAR_CODEC_ID,
    typeParams: { length },
  } as const;
}

export function varcharColumn<const Length extends number>(
  length: Length,
): ColumnTypeDescriptor<typeof SQL_VARCHAR_CODEC_ID> & {
  readonly typeParams: { readonly length: Length };
};
export function varcharColumn(length: number): ColumnTypeDescriptor<typeof SQL_VARCHAR_CODEC_ID> & {
  readonly typeParams: { readonly length: number };
} {
  return {
    codecId: SQL_VARCHAR_CODEC_ID,
    typeParams: { length },
  } as const;
}

/** A column of a type no other column type covers, named exactly as the database catalog prints it, such as `rawColumn('tsvector')` (ADR 273). Its values are typed `unknown`. */
export function rawColumn<const Sql extends string>(
  sql: Sql,
): ColumnTypeDescriptor<typeof SQL_RAW_CODEC_ID> & { readonly typeParams: { readonly sql: Sql } } {
  return { codecId: SQL_RAW_CODEC_ID, typeParams: { sql } } as const;
}

export const int4Column = {
  codecId: PG_INT4_CODEC_ID,
} as const satisfies ColumnTypeDescriptor;

export const int2Column = {
  codecId: PG_INT2_CODEC_ID,
} as const satisfies ColumnTypeDescriptor;

export const int8Column = {
  codecId: PG_INT8_CODEC_ID,
} as const satisfies ColumnTypeDescriptor;

export const float4Column = {
  codecId: PG_FLOAT4_CODEC_ID,
} as const satisfies ColumnTypeDescriptor;

export const float8Column = {
  codecId: PG_FLOAT8_CODEC_ID,
} as const satisfies ColumnTypeDescriptor;

export function numericColumn<const Precision extends number>(
  precision: Precision,
): ColumnTypeDescriptor<typeof PG_NUMERIC_CODEC_ID> & {
  readonly typeParams: { readonly precision: Precision };
};
export function numericColumn<const Precision extends number, const Scale extends number>(
  precision: Precision,
  scale: Scale,
): ColumnTypeDescriptor<typeof PG_NUMERIC_CODEC_ID> & {
  readonly typeParams: { readonly precision: Precision; readonly scale: Scale };
};
export function numericColumn(
  precision: number,
  scale?: number,
): ColumnTypeDescriptor<typeof PG_NUMERIC_CODEC_ID> & {
  readonly typeParams: { readonly precision: number; readonly scale?: number };
};
export function numericColumn(
  precision: number,
  scale?: number,
): ColumnTypeDescriptor<typeof PG_NUMERIC_CODEC_ID> & {
  readonly typeParams: { readonly precision: number; readonly scale?: number };
} {
  return {
    codecId: PG_NUMERIC_CODEC_ID,
    typeParams: scale === undefined ? { precision } : { precision, scale },
  } as const;
}

/**
 * Representation-explicit temporal descriptors share storage types but select different application
 * values: `Temporal.*`, PostgreSQL text, or a JavaScript `Date` for `timestamptz`.
 */
export const dateTemporalColumn = {
  codecId: PG_DATE_TEMPORAL_CODEC_ID,
} as const satisfies ColumnTypeDescriptor;

export const dateStringColumn = {
  codecId: PG_DATE_STRING_CODEC_ID,
} as const satisfies ColumnTypeDescriptor;

export const timestampTemporalColumn = {
  codecId: PG_TIMESTAMP_TEMPORAL_CODEC_ID,
} as const satisfies ColumnTypeDescriptor;

export const timestampStringColumn = {
  codecId: PG_TIMESTAMP_STRING_CODEC_ID,
} as const satisfies ColumnTypeDescriptor;

export const timestamptzTemporalColumn = {
  codecId: PG_TIMESTAMPTZ_TEMPORAL_CODEC_ID,
} as const satisfies ColumnTypeDescriptor;

export const timestamptzJsDateColumn = {
  codecId: PG_TIMESTAMPTZ_DATE_CODEC_ID,
} as const satisfies ColumnTypeDescriptor;

export const timestamptzStringColumn = {
  codecId: PG_TIMESTAMPTZ_STRING_CODEC_ID,
} as const satisfies ColumnTypeDescriptor;

export function timeTemporalColumn(): ColumnTypeDescriptor<typeof PG_TIME_TEMPORAL_CODEC_ID>;
export function timeTemporalColumn<const Precision extends number>(
  precision: Precision,
): ColumnTypeDescriptor<typeof PG_TIME_TEMPORAL_CODEC_ID> & {
  readonly typeParams: { readonly precision: Precision };
};
export function timeTemporalColumn(precision?: number): ColumnTypeDescriptor<
  typeof PG_TIME_TEMPORAL_CODEC_ID
> & {
  readonly typeParams?: { readonly precision: number };
};
export function timeTemporalColumn(precision?: number): ColumnTypeDescriptor<
  typeof PG_TIME_TEMPORAL_CODEC_ID
> & {
  readonly typeParams?: { readonly precision: number };
} {
  return {
    codecId: PG_TIME_TEMPORAL_CODEC_ID,
    ...(precision === undefined ? {} : { typeParams: { precision } }),
  } as const;
}

export function timeStringColumn(): ColumnTypeDescriptor<typeof PG_TIME_STRING_CODEC_ID>;
export function timeStringColumn<const Precision extends number>(
  precision: Precision,
): ColumnTypeDescriptor<typeof PG_TIME_STRING_CODEC_ID> & {
  readonly typeParams: { readonly precision: Precision };
};
export function timeStringColumn(precision?: number): ColumnTypeDescriptor<
  typeof PG_TIME_STRING_CODEC_ID
> & {
  readonly typeParams?: { readonly precision: number };
};
export function timeStringColumn(precision?: number): ColumnTypeDescriptor<
  typeof PG_TIME_STRING_CODEC_ID
> & {
  readonly typeParams?: { readonly precision: number };
} {
  return {
    codecId: PG_TIME_STRING_CODEC_ID,
    ...(precision === undefined ? {} : { typeParams: { precision } }),
  } as const;
}

export function timetzColumn(): ColumnTypeDescriptor<typeof PG_TIMETZ_CODEC_ID>;
export function timetzColumn<const Precision extends number>(
  precision: Precision,
): ColumnTypeDescriptor<typeof PG_TIMETZ_CODEC_ID> & {
  readonly typeParams: { readonly precision: Precision };
};
export function timetzColumn(precision?: number): ColumnTypeDescriptor<
  typeof PG_TIMETZ_CODEC_ID
> & {
  readonly typeParams?: { readonly precision: number };
};
export function timetzColumn(precision?: number): ColumnTypeDescriptor<
  typeof PG_TIMETZ_CODEC_ID
> & {
  readonly typeParams?: { readonly precision: number };
} {
  return {
    codecId: PG_TIMETZ_CODEC_ID,
    ...(precision === undefined ? {} : { typeParams: { precision } }),
  } as const;
}

export const boolColumn = {
  codecId: PG_BOOL_CODEC_ID,
} as const satisfies ColumnTypeDescriptor;

export function bitColumn<const Length extends number>(
  length: Length,
): ColumnTypeDescriptor<typeof PG_BIT_CODEC_ID> & {
  readonly typeParams: { readonly length: Length };
};
export function bitColumn(length: number): ColumnTypeDescriptor<typeof PG_BIT_CODEC_ID> & {
  readonly typeParams: { readonly length: number };
} {
  return {
    codecId: PG_BIT_CODEC_ID,
    typeParams: { length },
  } as const;
}

export function varbitColumn<const Length extends number>(
  length: Length,
): ColumnTypeDescriptor<typeof PG_VARBIT_CODEC_ID> & {
  readonly typeParams: { readonly length: Length };
};
export function varbitColumn(length: number): ColumnTypeDescriptor<typeof PG_VARBIT_CODEC_ID> & {
  readonly typeParams: { readonly length: number };
} {
  return {
    codecId: PG_VARBIT_CODEC_ID,
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
} as const satisfies ColumnTypeDescriptor;

export function intervalColumn(): ColumnTypeDescriptor<typeof PG_INTERVAL_CODEC_ID>;
export function intervalColumn<const Precision extends number>(
  precision: Precision,
): ColumnTypeDescriptor<typeof PG_INTERVAL_CODEC_ID> & {
  readonly typeParams: { readonly precision: Precision };
};
export function intervalColumn(precision?: number): ColumnTypeDescriptor<
  typeof PG_INTERVAL_CODEC_ID
> & {
  readonly typeParams?: { readonly precision: number };
};
export function intervalColumn(precision?: number): ColumnTypeDescriptor<
  typeof PG_INTERVAL_CODEC_ID
> & {
  readonly typeParams?: { readonly precision: number };
} {
  return {
    codecId: PG_INTERVAL_CODEC_ID,
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
} as const satisfies ColumnTypeDescriptor;

/**
 * Postgres `jsonb` column descriptor — untyped raw JSONB. Same retirement note as {@link jsonColumn}.
 */
export const jsonbColumn = {
  codecId: PG_JSONB_CODEC_ID,
} as const satisfies ColumnTypeDescriptor;
