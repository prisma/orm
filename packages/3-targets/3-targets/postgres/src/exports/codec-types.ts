/**
 * Codec type definitions for the Postgres target.
 *
 * This file is the public origin of `CodecTypes`. The `Resolve<...>` materialisation happens here (rather than in `core/codec-type-map.ts`) so the tsdown DTS bundler resolves consumer-side `.d.mts` references via this public entry point rather than a hash-named internal chunk (the `TS2742` family).
 *
 * Lives in `target-postgres` because codec types describe the target's value space — both the control adapter (introspection / schema verification) and the runtime adapter (encode/decode) share the same definitions, and the target package is the natural home that both adapters depend on.
 */

import type { JsonValue } from '@internal/contract/types';
import type { ExtractedCodecTypes, Resolve } from '../core/codec-type-map';

export type CodecTypes = Resolve<ExtractedCodecTypes>;

/**
 * The application value of a `pg/interval@1` column. Re-exported here — the
 * public origin of the codec type graph — because `CodecTypes` names it, and a
 * consumer's emitted `.d.mts` must reach it through a public entry point rather
 * than through a hash-named internal chunk (the `TS2742` family).
 */
export type { PgInterval } from '../core/codec-helpers';
export type { JsonValue };

type Branded<T, Shape extends Record<string, unknown>> = T & {
  readonly [K in keyof Shape]: Shape[K];
};

type BrandedString<Shape extends Record<string, unknown>> = Branded<string, Shape>;

export type Char<N extends number> = BrandedString<{ __charLength: N }>;
export type Varchar<N extends number> = BrandedString<{ __varcharLength: N }>;
export type Numeric<P extends number, S extends number | undefined = undefined> = BrandedString<{
  __numericPrecision: P;
  __numericScale: S;
}>;
export type Bit<N extends number> = BrandedString<{ __bitLength: N }>;
export type VarBit<N extends number> = BrandedString<{ __varbitLength: N }>;
export type Timestamp<P extends number | undefined = undefined> = BrandedString<{
  __timestampPrecision: P;
}>;
export type Timestamptz<P extends number | undefined = undefined> = BrandedString<{
  __timestamptzPrecision: P;
}>;
export type Time<P extends number | undefined = undefined> = BrandedString<{ __timePrecision: P }>;
export type Timetz<P extends number | undefined = undefined> = BrandedString<{
  __timetzPrecision: P;
}>;
/**
 * Read types for the representation-explicit `*-string` temporal codecs, whose application value is
 * PostgreSQL's own rendering of the column, forwarded in both directions without interpretation.
 * The brand records which native type produced the text; the write side stays a plain `string`, so
 * any value PostgreSQL accepts can be written without a cast.
 */
export type TimestampString<P extends number | undefined = undefined> = BrandedString<{
  __timestampStringPrecision: P;
}>;
export type TimestamptzString<P extends number | undefined = undefined> = BrandedString<{
  __timestamptzStringPrecision: P;
}>;
export type TimeString<P extends number | undefined = undefined> = BrandedString<{
  __timeStringPrecision: P;
}>;
export type Interval<P extends number | undefined = undefined> = BrandedString<{
  __intervalPrecision: P;
}>;
