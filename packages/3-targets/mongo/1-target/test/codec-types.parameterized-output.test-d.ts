import type { ParameterizedOutputType } from '@internal/contract/types';
import { expectTypeOf, test } from 'vitest';
import type { ParameterizedOutputTypesForTypeParams, Vector } from '../src/exports/codec-types';

type VectorOutput<TypeParams extends Record<string, unknown>> = ParameterizedOutputType<
  ParameterizedOutputTypesForTypeParams,
  'mongo/vector@1',
  TypeParams,
  readonly number[]
>;

test('a vector with a length reads as Vector of that length', () => {
  expectTypeOf<VectorOutput<{ readonly length: 1536 }>>().toEqualTypeOf<Vector<1536>>();
});

test('a vector without a length keeps the plain output type', () => {
  expectTypeOf<VectorOutput<Record<never, never>>>().toEqualTypeOf<readonly number[]>();
});

test('other codecs keep their plain output type', () => {
  expectTypeOf<
    ParameterizedOutputType<
      ParameterizedOutputTypesForTypeParams,
      'mongo/string@1',
      { readonly length: 3 },
      string
    >
  >().toEqualTypeOf<string>();
});
