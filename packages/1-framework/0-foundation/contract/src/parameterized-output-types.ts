/**
 * A pack's codec output types refined by a column's type parameters. A pack declares an interface extending this one whose `outputTypes` reads `this['typeParams']`, and names it in `types.codecTypes.parameterizedOutputTypes`. A codec it leaves out, or maps to `never`, keeps its plain output type.
 */
export interface ParameterizedOutputTypesFunction {
  readonly typeParams: Record<never, unknown>;
  readonly outputTypes: Record<string, unknown>;
}

export type ApplyParameterizedOutputTypes<
  TypeFunction extends ParameterizedOutputTypesFunction,
  TypeParams extends Record<string, unknown>,
> = (TypeFunction & { readonly typeParams: TypeParams })['outputTypes'];

type RefinedOutputType<
  TypeFunction,
  CodecId,
  TypeParams extends Record<string, unknown>,
> = TypeFunction extends ParameterizedOutputTypesFunction
  ? ApplyParameterizedOutputTypes<TypeFunction, TypeParams> extends infer Outputs
    ? CodecId extends keyof Outputs
      ? Outputs[CodecId]
      : never
    : never
  : never;

/**
 * The output type of a column of codec `CodecId` with these type parameters: the type one of `TypeFunctions` gives it, or `Plain` when none gives one. `TypeFunctions` is a union, one member per pack; each is applied on its own, because intersecting type functions makes TypeScript give up on deeply nested types. An emitted `contract.d.ts` and a contract written in TypeScript both type a column with type parameters through it.
 */
export type ParameterizedOutputType<
  TypeFunctions extends ParameterizedOutputTypesFunction,
  CodecId,
  TypeParams extends Record<string, unknown>,
  Plain,
> = [RefinedOutputType<TypeFunctions, CodecId, TypeParams>] extends [never]
  ? Plain
  : RefinedOutputType<TypeFunctions, CodecId, TypeParams>;
