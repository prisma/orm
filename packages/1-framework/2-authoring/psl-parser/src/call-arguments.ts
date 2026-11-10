import { notOk, ok, type Result } from '@internal/utils/result';
import type { ResolvedAttributeArg, ResolvedTypeConstructorCall } from './resolve';

/** The call as the schema writes it, with its arguments separated by `, `. */
export function printTypeConstructorCall(call: ResolvedTypeConstructorCall): string {
  const args = call.args.map((arg) =>
    arg.kind === 'named' ? `${arg.name}: ${arg.value}` : arg.value,
  );
  return `${call.path.join('.')}(${args.join(', ')})`;
}

/** An argument and the index of the parameter it fills. */
export interface BoundCallArgument {
  readonly argument: ResolvedAttributeArg;
  readonly index: number;
}

/** Why a call's arguments do not bind to its parameters, and the arguments bound before the one that failed. */
export type CallArgumentBindingFailure = { readonly bound: readonly BoundCallArgument[] } & (
  | { readonly kind: 'tooManyPositional'; readonly received: number }
  | { readonly kind: 'unknownName'; readonly argument: ResolvedAttributeArg }
  | { readonly kind: 'filledTwice'; readonly argument: ResolvedAttributeArg }
);

/**
 * Binds a call's arguments to its parameters, as PSL reads every call: the positional arguments fill the parameters in order, wherever named ones sit among them, and a named argument fills the parameter it names, which no other argument may fill. The bound arguments come positional ones first, then named ones, each in the order written.
 */
export function bindCallArguments(
  args: readonly ResolvedAttributeArg[],
  parameters: readonly (string | undefined)[],
): Result<readonly BoundCallArgument[], CallArgumentBindingFailure> {
  const positional = args.filter((arg) => arg.kind === 'positional');
  if (positional.length > parameters.length) {
    return notOk({ kind: 'tooManyPositional', received: positional.length, bound: [] });
  }
  const bound: BoundCallArgument[] = positional.map((argument, index) => ({ argument, index }));
  const filled = new Set(bound.map(({ index }) => index));
  for (const argument of args.filter((arg) => arg.kind === 'named')) {
    const index = argument.name === undefined ? -1 : parameters.indexOf(argument.name);
    if (index < 0) return notOk({ kind: 'unknownName', argument, bound });
    if (filled.has(index)) return notOk({ kind: 'filledTwice', argument, bound });
    filled.add(index);
    bound.push({ argument, index });
  }
  return ok(bound);
}

/** Each argument's value, keyed by the parameter it fills, as {@link bindCallArguments} binds them; `undefined` when they do not bind. */
export function argumentsByParameter(
  args: readonly ResolvedAttributeArg[],
  parameters: readonly string[],
): ReadonlyMap<string, string> | undefined {
  const bound = bindCallArguments(args, parameters);
  if (!bound.ok) return undefined;
  const values = new Map<string, string>();
  for (const { argument, index } of bound.value) {
    const parameter = parameters[index];
    if (parameter === undefined) return undefined;
    values.set(parameter, argument.value);
  }
  return values;
}
