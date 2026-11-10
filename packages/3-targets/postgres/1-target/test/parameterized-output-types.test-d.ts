import type { ParameterizedOutputType } from '@internal/contract/types';
import { describe, expectTypeOf, test } from 'vitest';
import type {
  Bit,
  Char,
  CodecTypes,
  Numeric,
  ParameterizedOutputTypesForTypeParams,
  PgInterval,
  TimeString,
  TimestampString,
  TimestamptzString,
  Timetz,
  VarBit,
  Varchar,
} from '../src/exports/codec-types';

type Output<
  CodecId extends keyof CodecTypes,
  TypeParams extends Record<string, unknown>,
> = ParameterizedOutputType<
  ParameterizedOutputTypesForTypeParams,
  CodecId,
  TypeParams,
  CodecTypes[CodecId]['output']
>;

describe('the output type of a Postgres column with type parameters', () => {
  test('carries a length', () => {
    expectTypeOf<Output<'pg/char@1', { readonly length: 36 }>>().toEqualTypeOf<Char<36>>();
    expectTypeOf<Output<'sql/char@1', { readonly length: 24 }>>().toEqualTypeOf<Char<24>>();
    expectTypeOf<Output<'pg/varchar@1', { readonly length: 20 }>>().toEqualTypeOf<Varchar<20>>();
    expectTypeOf<Output<'sql/varchar@1', { readonly length: 255 }>>().toEqualTypeOf<Varchar<255>>();
    expectTypeOf<Output<'pg/bit@1', { readonly length: 8 }>>().toEqualTypeOf<Bit<8>>();
    expectTypeOf<Output<'pg/varbit@1', { readonly length: 16 }>>().toEqualTypeOf<VarBit<16>>();
  });

  test('is the plain output type when the length is absent', () => {
    expectTypeOf<Output<'pg/char@1', Record<never, never>>>().toEqualTypeOf<
      CodecTypes['pg/char@1']['output']
    >();
    expectTypeOf<Output<'pg/bit@1', Record<never, never>>>().toEqualTypeOf<
      CodecTypes['pg/bit@1']['output']
    >();
  });

  test('carries a numeric precision and scale', () => {
    expectTypeOf<
      Output<'pg/numeric@1', { readonly precision: 10; readonly scale: 2 }>
    >().toEqualTypeOf<Numeric<10, 2>>();
    expectTypeOf<Output<'pg/numeric@1', { readonly precision: 10 }>>().toEqualTypeOf<Numeric<10>>();
    expectTypeOf<Output<'pg/numeric@1', Record<never, never>>>().toEqualTypeOf<
      CodecTypes['pg/numeric@1']['output']
    >();
  });

  test('keeps the interval parts an interval with a precision reads', () => {
    expectTypeOf<Output<'pg/interval@1', { readonly precision: 6 }>>().toEqualTypeOf<PgInterval>();
  });

  test('carries a time precision, or none', () => {
    expectTypeOf<Output<'pg/timetz@1', { readonly precision: 3 }>>().toEqualTypeOf<Timetz<3>>();
    expectTypeOf<Output<'pg/timestamp-string@1', { readonly precision: 6 }>>().toEqualTypeOf<
      TimestampString<6>
    >();
    expectTypeOf<Output<'pg/timestamptz-string@1', { readonly precision: 3 }>>().toEqualTypeOf<
      TimestamptzString<3>
    >();
    expectTypeOf<Output<'pg/time-string@1', { readonly precision: 0 }>>().toEqualTypeOf<
      TimeString<0>
    >();
    expectTypeOf<Output<'pg/time-string@1', Record<never, never>>>().toEqualTypeOf<TimeString>();
    expectTypeOf<
      Output<'pg/timestamptz-date@1', { readonly precision: 3 }>
    >().toEqualTypeOf<Date>();
  });

  test('is the plain output type for a codec the type function leaves out', () => {
    expectTypeOf<Output<'pg/timestamptz-temporal@1', { readonly precision: 3 }>>().toEqualTypeOf<
      CodecTypes['pg/timestamptz-temporal@1']['output']
    >();
    expectTypeOf<Output<'pg/date-string@1', { readonly precision: 3 }>>().toEqualTypeOf<
      CodecTypes['pg/date-string@1']['output']
    >();
  });
});
