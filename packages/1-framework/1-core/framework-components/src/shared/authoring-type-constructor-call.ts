import { canonicalizeJson } from '../utils/canonicalize-json';
import {
  type AuthoringTypeConstructorDescriptor,
  type AuthoringTypeNamespace,
  instantiateAuthoringTypeConstructor,
  isAuthoringArgRef,
  isAuthoringTypeConstructorDescriptor,
} from './framework-authoring';

/** What a type constructor call produces for a column. */
export type AuthoringTypeConstructorOutput = ReturnType<typeof instantiateAuthoringTypeConstructor>;

/** A type constructor, by its path in an authoring namespace, and the arguments of one call to it. */
export interface AuthoringTypeConstructorCall {
  readonly path: readonly string[];
  readonly args: readonly unknown[];
}

function* typeConstructors(
  namespace: AuthoringTypeNamespace,
  path: readonly string[] = [],
): Generator<{
  readonly path: readonly string[];
  readonly descriptor: AuthoringTypeConstructorDescriptor;
}> {
  for (const [name, value] of Object.entries(namespace)) {
    if (isAuthoringTypeConstructorDescriptor(value)) {
      yield { path: [...path, name], descriptor: value };
    } else {
      yield* typeConstructors(value, [...path, name]);
    }
  }
}

function produces(
  produced: AuthoringTypeConstructorOutput,
  wanted: AuthoringTypeConstructorOutput,
): boolean {
  const wantedFields: Readonly<Record<string, unknown>> = {
    ...wanted,
    typeParams: wanted.typeParams ?? {},
  };
  return Object.entries({ ...produced, typeParams: produced.typeParams ?? {} }).every(
    ([key, value]) => canonicalizeJson(value) === canonicalizeJson(wantedFields[key]),
  );
}

/**
 * The arguments that make `descriptor` produce exactly `output`, when each of its type parameters
 * comes straight from one argument; `undefined` when it cannot produce `output`, including when
 * `output` has no value for an argument the constructor requires.
 */
function argumentsFor(
  descriptor: AuthoringTypeConstructorDescriptor,
  output: AuthoringTypeConstructorOutput,
): readonly unknown[] | undefined {
  if (descriptor.entityRefArg !== undefined || descriptor.output.codecId !== output.codecId) {
    return undefined;
  }
  const args: unknown[] = [];
  for (const [key, template] of Object.entries(descriptor.output.typeParams ?? {})) {
    const value = output.typeParams?.[key];
    if (value !== undefined && isAuthoringArgRef(template) && template.path === undefined) {
      args[template.index] = value;
    }
  }
  const requiredArgs = (descriptor.args ?? []).filter((arg) => arg.optional !== true).length;
  if (args.length < requiredArgs || Array.from(args).includes(undefined)) return undefined;
  try {
    return produces(instantiateAuthoringTypeConstructor(descriptor, args), output)
      ? args
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The first call, in namespace order, to a type constructor in `namespace` that produces exactly
 * `output`. The inverse of {@link instantiateAuthoringTypeConstructor} for constructors whose type
 * parameters each come straight from one argument. A constructor whose argument names another
 * entity is never chosen. `undefined` when no call produces `output`.
 */
export function findAuthoringTypeConstructorCall(
  namespace: AuthoringTypeNamespace,
  output: AuthoringTypeConstructorOutput,
): AuthoringTypeConstructorCall | undefined {
  for (const { path, descriptor } of typeConstructors(namespace)) {
    const args = argumentsFor(descriptor, output);
    if (args !== undefined) return { path, args };
  }
  return undefined;
}
