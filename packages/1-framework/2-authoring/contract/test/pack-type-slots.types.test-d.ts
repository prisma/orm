import type { ParameterizedOutputTypesFunction } from '@internal/contract/types';
import { expectTypeOf, test } from 'vitest';
import type { ExtractParameterizedOutputTypesFromPack } from '../src/pack-type-slots';

interface TypeFunction extends ParameterizedOutputTypesFunction {
  readonly outputTypes: { readonly 'x/y@1': string };
}

test('a pack that declares a type function gives it', () => {
  expectTypeOf<
    ExtractParameterizedOutputTypesFromPack<{ readonly __parameterizedOutputTypes?: TypeFunction }>
  >().toEqualTypeOf<TypeFunction>();
});

test('a pack that declares none gives never', () => {
  expectTypeOf<ExtractParameterizedOutputTypesFromPack<{ readonly id: 'x' }>>().toBeNever();
});
