/**
 * Codec type definitions for the Postgres target.
 *
 * This file is the public origin of `CodecTypes`. The `Resolve<...>` materialisation happens here (rather than in `core/codec-type-map.ts`) so the tsdown DTS bundler resolves consumer-side `.d.mts` references via this public entry point rather than a hash-named internal chunk (the `TS2742` family).
 *
 * Lives in `target-postgres` because codec types describe the target's value space — both the control adapter (introspection / schema verification) and the runtime adapter (encode/decode) share the same definitions, and the target package is the natural home that both adapters depend on.
 */

import type { JsonValue, ParameterizedOutputTypesFunction } from '@internal/contract/types';
import type { ExtractedCodecTypes, Resolve } from '../core/codec-type-map';

export type CodecTypes = Resolve<ExtractedCodecTypes>;

/**
 * The application value of a `pg/interval@1` column. Re-exported here — the
 * public origin of the codec type graph — because `CodecTypes` names it, and a
 * consumer's emitted `.d.mts` must reach it through a public entry point rather
 * than through a hash-named internal chunk (the `TS2742` family).
 */
export type { PgInterval } from '../core/data-type-values';
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
export type Timetz<P extends number | undefined = undefined> = BrandedString<{
  __timetzPrecision: P;
}>;
export type TimestampString<P extends number | undefined = undefined> = BrandedString<{
  __timestampStringPrecision: P;
}>;
export type TimestamptzString<P extends number | undefined = undefined> = BrandedString<{
  __timestamptzStringPrecision: P;
}>;
export type TimeString<P extends number | undefined = undefined> = BrandedString<{
  __timeStringPrecision: P;
}>;

type LengthParam<TypeParams> = TypeParams extends { readonly length: infer N extends number }
  ? N
  : never;

type PrecisionParam<TypeParams> = TypeParams extends {
  readonly precision: infer P extends number;
}
  ? P
  : undefined;

type NumericOutput<TypeParams> = TypeParams extends { readonly precision: infer P extends number }
  ? TypeParams extends { readonly scale: infer S extends number }
    ? Numeric<P, S>
    : Numeric<P>
  : never;

type LengthOutput<TypeParams, Output> = [LengthParam<TypeParams>] extends [never] ? never : Output;

type OutputTypeMap<TypeParams> = {
  readonly 'pg/numeric@1': NumericOutput<TypeParams>;
  readonly 'pg/char@1': LengthOutput<TypeParams, Char<LengthParam<TypeParams>>>;
  readonly 'sql/char@1': LengthOutput<TypeParams, Char<LengthParam<TypeParams>>>;
  readonly 'pg/varchar@1': LengthOutput<TypeParams, Varchar<LengthParam<TypeParams>>>;
  readonly 'sql/varchar@1': LengthOutput<TypeParams, Varchar<LengthParam<TypeParams>>>;
  readonly 'pg/bit@1': LengthOutput<TypeParams, Bit<LengthParam<TypeParams>>>;
  readonly 'pg/varbit@1': LengthOutput<TypeParams, VarBit<LengthParam<TypeParams>>>;
  readonly 'pg/timetz@1': Timetz<PrecisionParam<TypeParams>>;
  readonly 'pg/time-string@1': TimeString<PrecisionParam<TypeParams>>;
  readonly 'pg/timestamp-string@1': TimestampString<PrecisionParam<TypeParams>>;
  readonly 'pg/timestamptz-string@1': TimestamptzString<PrecisionParam<TypeParams>>;
  readonly 'pg/timestamptz-date@1': Date;
};

/**
 * The output type of each codec whose output type depends on the column's type parameters: the only declaration of these types, which a contract written with `defineContract` and the `contract.d.ts` that `prisma contract emit` writes both apply.
 */
export interface ParameterizedOutputTypesForTypeParams extends ParameterizedOutputTypesFunction {
  readonly outputTypes: OutputTypeMap<this['typeParams']>;
}
