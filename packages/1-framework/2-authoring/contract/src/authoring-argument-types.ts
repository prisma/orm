import type { AuthoringArgumentDescriptor } from '@internal/framework-components/authoring';

export type OptionalObjectArgumentKeys<
  Properties extends Record<string, AuthoringArgumentDescriptor>,
> = {
  readonly [K in keyof Properties]: Properties[K] extends { readonly optional: true } ? K : never;
}[keyof Properties];

type RequiredObjectArgumentKeys<Properties extends Record<string, AuthoringArgumentDescriptor>> =
  Exclude<keyof Properties, OptionalObjectArgumentKeys<Properties>>;

/**
 * When every property is optional the result must be a plain weak type rather
 * than `{} & { … }`: TypeScript's weak-type check rejects an object sharing
 * none of the target's properties, but only when the target is weak — and an
 * intersection with `{}` is not. The TS authoring surface runs no runtime
 * argument validation, so this check is the only thing rejecting a foreign key
 * such as `field.nanoid({ bogus: 1 })`.
 */
export type ObjectArgumentType<Properties extends Record<string, AuthoringArgumentDescriptor>> = [
  RequiredObjectArgumentKeys<Properties>,
] extends [never]
  ? {
      readonly [K in OptionalObjectArgumentKeys<Properties>]?: ArgTypeFromDescriptor<Properties[K]>;
    }
  : {
      readonly [K in RequiredObjectArgumentKeys<Properties>]: ArgTypeFromDescriptor<Properties[K]>;
    } & {
      readonly [K in OptionalObjectArgumentKeys<Properties>]?: ArgTypeFromDescriptor<Properties[K]>;
    };

export type ArgTypeFromDescriptor<Arg extends AuthoringArgumentDescriptor> = Arg extends {
  readonly kind: 'string';
}
  ? string
  : Arg extends { readonly kind: 'boolean' }
    ? boolean
    : Arg extends { readonly kind: 'number' }
      ? number
      : Arg extends { readonly kind: 'stringArray' }
        ? readonly string[]
        : Arg extends {
              readonly kind: 'option';
              readonly values: infer Values extends readonly string[];
            }
          ? Values[number]
          : Arg extends {
                readonly kind: 'object';
                readonly properties: infer Properties extends Record<
                  string,
                  AuthoringArgumentDescriptor
                >;
              }
            ? ObjectArgumentType<Properties>
            : never;

/**
 * Recursive rewrite (not a mapped tuple type) so a descriptor marked
 * `optional: true` gets an optional tuple slot (`Type?`), letting callers
 * omit it and every optional arg after it. Required args must precede
 * optional args in a descriptor's `args` list — TypeScript rejects an
 * optional tuple element followed by a required one, and the runtime
 * (`validateAuthoringHelperArguments`'s `minimumArgs`) already treats an
 * optional-before-required arg as effectively required.
 */
export type TupleFromArgumentDescriptors<Args extends readonly AuthoringArgumentDescriptor[]> =
  Args extends readonly [
    infer Head extends AuthoringArgumentDescriptor,
    ...infer Tail extends readonly AuthoringArgumentDescriptor[],
  ]
    ? Head extends { readonly optional: true }
      ? readonly [ArgTypeFromDescriptor<Head>?, ...TupleFromArgumentDescriptors<Tail>]
      : readonly [ArgTypeFromDescriptor<Head>, ...TupleFromArgumentDescriptors<Tail>]
    : readonly [];

export type ResolveTemplateValue<Template, Args extends readonly unknown[]> = Template extends {
  readonly kind: 'arg';
  readonly index: infer Index extends number;
  readonly path?: infer Path extends readonly string[] | undefined;
  readonly default?: infer Default;
}
  ? ResolveTemplateArgValue<Args[Index], Path, Default, Args>
  : Template extends readonly unknown[]
    ? { readonly [K in keyof Template]: ResolveTemplateValue<Template[K], Args> }
    : Template extends Record<string, unknown>
      ? { readonly [K in keyof Template]: ResolveTemplateValue<Template[K], Args> }
      : Template;

type ResolveTemplatePathValue<
  Value,
  Path extends readonly string[] | undefined,
> = Path extends readonly [infer Segment extends string, ...infer Rest extends readonly string[]]
  ? Segment extends keyof NonNullable<Value>
    ? ResolveTemplatePathValue<NonNullable<Value>[Segment], Rest>
    : never
  : Value;

type ResolveTemplateDefaultValue<
  Value,
  Default,
  Args extends readonly unknown[],
> = Default extends undefined
  ? Value
  : [Value] extends [never]
    ? ResolveTemplateValue<Default, Args>
    : undefined extends Value
      ? Exclude<Value, undefined> | ResolveTemplateValue<Default, Args>
      : Value;

type ResolveTemplateArgValue<
  Value,
  Path extends readonly string[] | undefined,
  Default,
  Args extends readonly unknown[],
> = ResolveTemplateDefaultValue<ResolveTemplatePathValue<Value, Path>, Default, Args>;
