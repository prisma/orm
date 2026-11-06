import { isInternalError } from '@internal/utils/internal-error';
import {
  type AuthoringTypeChoiceDescriptor,
  authoringTypeNamespaceLevel,
  instantiateAuthoringTypeCall,
  isAuthoringTypeChoiceOption,
  resolveAuthoringTypeChoice,
  typeConstructorLookup,
} from './authoring-type-choice';
import {
  type AuthoringTypeConstructorCall,
  type AuthoringTypeConstructorOutput,
  sameAuthoringTypeConstructorOutput,
} from './authoring-type-constructor-call';
import {
  type AuthoringTypeNamespace,
  instantiateAuthoringTypeConstructor,
  isAuthoringTypeChoiceDescriptor,
} from './framework-authoring';

/** One argument of a type choice call, written by name. */
export interface AuthoringTypeChoiceCallArgument {
  readonly name: string;
  readonly value: unknown;
}

/** A type choice, by its path in an authoring namespace, and the arguments of one call to it in the choice's argument order; an argument left out takes its default. */
export interface AuthoringTypeChoiceCall {
  readonly path: readonly string[];
  readonly args: readonly AuthoringTypeChoiceCallArgument[];
  /** The type constructor call the type choice call becomes. */
  readonly becomes: AuthoringTypeConstructorCall;
}

interface ChoiceNaming {
  readonly name: string;
  readonly descriptor: AuthoringTypeChoiceDescriptor;
  readonly when: Readonly<Record<string, string>>;
}

function choicesNaming(
  level: AuthoringTypeNamespace,
  constructorName: string,
): readonly ChoiceNaming[] {
  return Object.entries(level).flatMap(([name, member]) => {
    if (!isAuthoringTypeChoiceDescriptor(member)) return [];
    const row = member.choices.find((candidate) => candidate.type === constructorName);
    return row === undefined ? [] : [{ name, descriptor: member, when: row.when }];
  });
}

function outputOf(produce: () => AuthoringTypeConstructorOutput) {
  try {
    return produce();
  } catch (error) {
    if (isInternalError(error)) throw error;
    return undefined;
  }
}

/**
 * The call to a type choice that becomes the type constructor call `call`: of the type choices at the constructor's level with a row naming the constructor, the first in namespace order whose call gives the same output. Its options come from that row and its passed-on arguments from the call, and every argument whose omission still gives the same output is left out. `sameOutput` decides what counts as the same output; by default the codec and type parameters must be exactly equal. `undefined` when no type choice names the constructor or no call to one gives the same output.
 */
export function findAuthoringTypeChoiceCall(input: {
  readonly namespace: AuthoringTypeNamespace;
  readonly call: AuthoringTypeConstructorCall;
  readonly sameOutput?: (
    produced: AuthoringTypeConstructorOutput,
    wanted: AuthoringTypeConstructorOutput,
  ) => boolean;
}): AuthoringTypeChoiceCall | undefined {
  const { call } = input;
  const sameOutput = input.sameOutput ?? sameAuthoringTypeConstructorOutput;
  const prefix = call.path.slice(0, -1);
  const constructorName = call.path.at(-1);
  const level = authoringTypeNamespaceLevel(input.namespace, prefix);
  if (level === undefined || constructorName === undefined) return undefined;
  const explicit = typeConstructorLookup(level)(constructorName);
  const wanted =
    explicit && outputOf(() => instantiateAuthoringTypeConstructor(explicit, call.args));
  if (explicit === undefined || wanted === undefined) return undefined;

  const passedValue = (name: string) =>
    call.args[(explicit.args ?? []).findIndex((parameter) => parameter.name === name)];
  for (const choice of choicesNaming(level, constructorName)) {
    const found = choiceCallReproducing({
      level,
      prefix,
      choice,
      passedValue,
      reproduces: (produced) => sameOutput(produced, wanted),
    });
    if (found !== undefined) return found;
  }
  return undefined;
}

function choiceCallReproducing(input: {
  readonly level: AuthoringTypeNamespace;
  readonly prefix: readonly string[];
  readonly choice: ChoiceNaming;
  readonly passedValue: (name: string) => unknown;
  readonly reproduces: (produced: AuthoringTypeConstructorOutput) => boolean;
}): AuthoringTypeChoiceCall | undefined {
  const { level, prefix, choice } = input;
  const reproduces = (args: readonly unknown[]) => {
    const produced = outputOf(() => instantiateAuthoringTypeCall(level, choice.name, args));
    return produced !== undefined && input.reproduces(produced);
  };

  const args: unknown[] = choice.descriptor.args.map((argument) =>
    isAuthoringTypeChoiceOption(argument)
      ? choice.when[argument.name]
      : input.passedValue(argument.name),
  );
  if (!reproduces(args)) return undefined;
  for (const index of args.keys()) {
    const without = args.map((value, at) => (at === index ? undefined : value));
    if (args[index] !== undefined && reproduces(without)) args[index] = undefined;
  }

  const chosen = resolveAuthoringTypeChoice({
    helperPath: choice.name,
    descriptor: choice.descriptor,
    args,
    constructorNamed: typeConstructorLookup(level),
  });
  const chosenArgs = [...chosen.args];
  while (chosenArgs.length > 0 && chosenArgs.at(-1) === undefined) chosenArgs.pop();
  return {
    path: [...prefix, choice.name],
    args: choice.descriptor.args.flatMap((argument, index) =>
      args[index] === undefined ? [] : [{ name: argument.name, value: args[index] }],
    ),
    becomes: { path: [...prefix, chosen.type], args: chosenArgs },
  };
}
