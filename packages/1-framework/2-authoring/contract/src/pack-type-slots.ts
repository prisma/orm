import type { ParameterizedOutputTypesFunction } from '@internal/contract/types';

/** The parameterized output type function a pack declares in its metadata's type (`__parameterizedOutputTypes`), or `never` when it declares none. */
export type PackParameterizedOutputTypes<Pack> = Pack extends {
  readonly __parameterizedOutputTypes?: infer TypeFunction;
}
  ? Exclude<TypeFunction, undefined> extends infer Defined extends ParameterizedOutputTypesFunction
    ? Defined
    : never
  : never;
