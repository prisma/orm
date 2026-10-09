import type { ParameterizedOutputType } from '@internal/contract/types';
import { expectTypeOf, test } from 'vitest';
import type {
  CodecTypes,
  ParameterizedOutputTypesForTypeParams,
  Vector,
} from '../src/exports/codec-types';

type VectorOutput<TypeParams extends Record<string, unknown>> = ParameterizedOutputType<
  ParameterizedOutputTypesForTypeParams,
  'pg/vector@1',
  TypeParams,
  CodecTypes['pg/vector@1']['output']
>;

test('a vector column with a length reads as a vector of that length', () => {
  expectTypeOf<VectorOutput<{ readonly length: 1536 }>>().toEqualTypeOf<Vector<1536>>();
  expectTypeOf<VectorOutput<{ readonly length: 3 }>>().toEqualTypeOf<Vector<3>>();
});

test('a vector column without a length reads as the plain vector type', () => {
  expectTypeOf<VectorOutput<Record<never, never>>>().not.toBeAny();
  expectTypeOf<VectorOutput<Record<never, never>>>().toEqualTypeOf<Vector>();
});
