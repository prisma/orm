import type { ParameterizedOutputTypesFunction } from '@internal/contract/types';
import { expectTypeOf, test } from 'vitest';
import type { PackParameterizedOutputTypes } from '../src/pack-type-slots';

interface TypeFunction extends ParameterizedOutputTypesFunction {
  readonly outputTypes: { readonly 'x/y@1': string };
}

test('a pack that declares a type function gives it', () => {
  expectTypeOf<
    PackParameterizedOutputTypes<{ readonly __parameterizedOutputTypes?: TypeFunction }>
  >().toEqualTypeOf<TypeFunction>();
});

test('a pack that declares none gives never', () => {
  expectTypeOf<PackParameterizedOutputTypes<{ readonly id: 'x' }>>().toBeNever();
});
