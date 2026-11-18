import type { ParameterizedOutputTypesFunction } from '@internal/contract/types';
import type { DataTypeArgumentTypes } from './authoring-argument-types';

/** The parameterized output type function a pack declares in its metadata's type (`__parameterizedOutputTypes`), or `never` when it declares none. */
export type ExtractParameterizedOutputTypesFromPack<Pack> = Pack extends {
  readonly __parameterizedOutputTypes?: infer TypeFunction;
}
  ? Exclude<TypeFunction, undefined> extends infer Defined extends ParameterizedOutputTypesFunction
    ? Defined
    : never
  : never;

/** The `value` argument types a pack declares in its type (`__dataTypeArguments`), or none. */
export type ExtractDataTypeArgumentTypesFromPack<Pack> = Pack extends {
  readonly __dataTypeArguments?: infer Declared;
}
  ? Exclude<Declared, undefined> extends infer Defined extends DataTypeArgumentTypes
    ? Defined
    : Record<never, never>
  : Record<never, never>;
