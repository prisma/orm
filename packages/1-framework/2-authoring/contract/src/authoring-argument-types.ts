import type { AuthoringArgumentDescriptor } from '@internal/framework-components/authoring';

/**
 * For each data type id, the TypeScript value a `value` argument of that data type takes (`argument`) and the type parameter it gives the constructor (`parameter`). A pack declares an entry for each data type it registers that arguments take, as `__dataTypeArguments` in its type.
 */
export type DataTypeArgumentTypes = {
  readonly [dataType: string]: { readonly argument: unknown; readonly parameter: unknown };
};

type NoDataTypeArgumentTypes = Record<never, never>;

/** The TypeScript type of one argument: what `ValueTypes` declares for its data type, and nothing when no pack declares it. */
export type ArgTypeFromDescriptor<
  Arg extends AuthoringArgumentDescriptor,
  ValueTypes extends DataTypeArgumentTypes = NoDataTypeArgumentTypes,
> = Arg['dataType'] extends keyof ValueTypes ? ValueTypes[Arg['dataType']]['argument'] : never;

/**
 * Recursive rewrite (not a mapped tuple type) so a descriptor marked `optional: true` gets an optional tuple slot (`(Type | undefined)?`), letting callers omit it and every optional arg after it, or pass `undefined` to skip it and still give a later one. Required args must precede optional args in a descriptor's `args` list — TypeScript rejects an optional tuple element followed by a required one, and the runtime (`validateAuthoringHelperArguments`'s `minimumArgs`) already treats an optional-before-required arg as effectively required.
 */
export type TupleFromArgumentDescriptors<
  Args extends readonly AuthoringArgumentDescriptor[],
  ValueTypes extends DataTypeArgumentTypes = NoDataTypeArgumentTypes,
> = Args extends readonly [
  infer Head extends AuthoringArgumentDescriptor,
  ...infer Tail extends readonly AuthoringArgumentDescriptor[],
]
  ? Head extends { readonly optional: true }
    ? readonly [
        (ArgTypeFromDescriptor<Head, ValueTypes> | undefined)?,
        ...TupleFromArgumentDescriptors<Tail, ValueTypes>,
      ]
    : readonly [
        ArgTypeFromDescriptor<Head, ValueTypes>,
        ...TupleFromArgumentDescriptors<Tail, ValueTypes>,
      ]
  : readonly [];

type CanonicalArgument<
  Arg extends AuthoringArgumentDescriptor,
  Param,
  ValueTypes extends DataTypeArgumentTypes,
> = Arg['dataType'] extends keyof ValueTypes
  ? Param extends ValueTypes[Arg['dataType']]['parameter'] | undefined
    ? Param
    : ValueTypes[Arg['dataType']]['parameter'] | Extract<Param, undefined>
  : Param;

/**
 * The arguments of a call as the constructor receives them: each `value` argument as the canonical value of its data type, kept literal when the written value already is one, so `VarChar(255)` still gives `255` and `` Raw(sql`circle`) `` gives a `string`.
 */
export type CanonicalArguments<
  Args extends readonly AuthoringArgumentDescriptor[],
  Params extends readonly unknown[],
  ValueTypes extends DataTypeArgumentTypes = NoDataTypeArgumentTypes,
> = {
  readonly [Index in keyof Params]: Index extends `${infer Position extends number}`
    ? Args[Position] extends infer Arg extends AuthoringArgumentDescriptor
      ? CanonicalArgument<Arg, Params[Index], ValueTypes>
      : Params[Index]
    : Params[Index];
};

export type ResolveTemplateValue<Template, Args extends readonly unknown[]> = Template extends {
  readonly kind: 'arg';
  readonly index: infer Index extends number;
}
  ? Args[Index]
  : Template extends readonly unknown[]
    ? { readonly [K in keyof Template]: ResolveTemplateValue<Template[K], Args> }
    : Template extends Record<string, unknown>
      ? { readonly [K in keyof Template]: ResolveTemplateValue<Template[K], Args> }
      : Template;
