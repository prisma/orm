import { blindCast } from '@internal/utils/casts';
import { createDataTypeLookup } from './data-type';
import type { GeneratorFunctionCall, GeneratorFunctionComponent } from './generator-functions';
import type { DataTypeSupport } from './written-value';

/** The value type an argument type of a signature parses to. psl-parser's `ArgTypeOutput` extends it, so `gen` reads the argument types of a `FuncCallSig` through this one definition. */
export interface SignatureArgumentOutput<T> {
  readonly _out?: T;
}

/** The mark psl-parser's `optional(...)` puts on an argument type; its `OptionalArgumentMarks` extends it. It makes the `gen` argument optional. */
export interface SignatureOptionalArgument {
  readonly optional: true;
}

type ArgumentOut<Type> =
  Type extends SignatureArgumentOutput<infer Out> ? Exclude<Out, undefined> : unknown;

type PositionalArguments<Params> = Params extends readonly [infer Head, ...infer Rest]
  ? Head extends { readonly type: infer Type }
    ? Type extends SignatureOptionalArgument
      ? [argument?: ArgumentOut<Type>, ...PositionalArguments<Rest>]
      : [argument: ArgumentOut<Type>, ...PositionalArguments<Rest>]
    : []
  : [];

/** A signature, or what a signature written as a function of the stack's data types returns. */
type SignatureObject<Signature> = Signature extends (...args: never) => infer Built
  ? Built
  : Signature;

/** The `gen` helper of one generator function, typed by the positional arguments of its signature. */
export type GeneratorHelper<Signature> = (
  ...args: SignatureObject<Signature> extends { readonly positional: infer Params }
    ? PositionalArguments<Params>
    : []
) => GeneratorFunctionCall;

type ContributionsOf<Component> = Component extends {
  readonly generatorFunctions?: infer Contributions;
}
  ? Contributions extends readonly (infer Contribution)[]
    ? Contribution
    : never
  : never;

type Declared<Contribution> = Contribution extends {
  readonly name: string;
  readonly signature: object;
}
  ? Contribution
  : never;

/** The pack refs of a record of extension packs, as a union. */
export type ExtensionPackValues<Extensions> =
  Extensions extends Record<string, infer Pack> ? Pack : never;

/** The `gen` helpers of a set of components: one per generator function they declare. */
export type GeneratorHelpersOf<Component> = {
  readonly [Contribution in Declared<
    ContributionsOf<Component>
  > as Contribution['name']]: GeneratorHelper<Contribution['signature']>;
};

/** The data types of a stack that registers none, which a signature written as a function of them is built against to read its parameter keys. */
const NO_DATA_TYPES: DataTypeSupport = {
  entries: {},
  lookup: createDataTypeLookup([]),
  dataTypeOfCodec: () => undefined,
};

function positionalKeys(declared: unknown): readonly string[] {
  const signature: unknown = typeof declared === 'function' ? declared(NO_DATA_TYPES) : declared;
  if (typeof signature !== 'object' || signature === null || !('positional' in signature)) {
    return [];
  }
  const positional: unknown = signature.positional;
  if (!Array.isArray(positional)) return [];
  return positional.flatMap((param: unknown) =>
    typeof param === 'object' && param !== null && 'key' in param && typeof param.key === 'string'
      ? [param.key]
      : [],
  );
}

/**
 * The `gen` helpers of a composed stack: one per generator function its components declare, taking the positional arguments of the function's signature. A call is resolved by the field's codec when the contract is built.
 */
export function createGeneratorHelpers<const Component extends GeneratorFunctionComponent>(
  components: readonly Component[],
): GeneratorHelpersOf<Component> {
  const helpers: Record<string, (...values: readonly unknown[]) => GeneratorFunctionCall> = {};
  for (const component of components) {
    for (const contribution of component.generatorFunctions ?? []) {
      if (contribution.signature === undefined) continue;
      const keys = positionalKeys(contribution.signature);
      const name = contribution.name;
      helpers[name] = (...values) => ({
        name,
        args: Object.fromEntries(
          keys.flatMap((key, index) =>
            values[index] === undefined ? [] : [[key, values[index]] as const],
          ),
        ),
      });
    }
  }
  return blindCast<
    GeneratorHelpersOf<Component>,
    'one helper per declared contribution is built above; the components decide only its type'
  >(helpers);
}
