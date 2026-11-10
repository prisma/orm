import type { ExecutionMutationDefaultValue } from '@internal/contract/types';
import { InternalError } from '@internal/utils/internal-error';
import type { MutationDefaultGeneratorDescriptor } from './mutation-default-types';
import { runtimeError } from './runtime-error';

/** The phase a client generator runs in: when a row is created, or every time it is updated. */
export type GeneratorPhase = 'onCreate' | 'onUpdate';

/** The codec and type params of the field a generator fills: a column in SQL, a document field in Mongo. */
export interface GeneratorFunctionField {
  readonly codecId: string;
  readonly typeParams: Readonly<Record<string, unknown>> | undefined;
  /** The column's length, in its data type's normal form, so a bare `Char` holds 1. `undefined` for a column with no length, or one whose database does not limit it; a binding then checks no length. */
  readonly length: number | undefined;
}

/** A call of a generator function: what `@onCreate(fn(...))` and `gen.fn(...)` write, and what `contract print` writes back. */
export interface GeneratorFunctionCall {
  readonly name: string;
  readonly args: Readonly<Record<string, unknown>>;
}

/** What one binding resolves a call to on a field: a generator, or a refusal with its reason. */
export type BindingResolution =
  | { readonly ok: true; readonly generator: ExecutionMutationDefaultValue }
  | { readonly ok: false; readonly message: string };

/** The arguments of a call, as values and as PSL text. */
export interface PrintedArguments {
  readonly args: Readonly<Record<string, unknown>>;
  readonly text: string;
}

export interface GeneratorFunctionBinding {
  readonly codecIds: readonly string[];
  /** Every generator id `resolve` can produce. */
  readonly generatorIds: readonly string[];
  readonly resolve: (input: {
    readonly args: Readonly<Record<string, unknown>>;
    readonly field: GeneratorFunctionField;
  }) => BindingResolution;
  /** The arguments that produce `generator` on `field`, or `undefined` when this binding never produces it. */
  readonly printArguments: (
    generator: ExecutionMutationDefaultValue,
    field: GeneratorFunctionField,
  ) => PrintedArguments | undefined;
}

export interface GeneratorFunctionContribution {
  readonly name: string;
  /** A `FuncCallSig`, typed `unknown` as `ControlMutationDefaultEntry.signature` is. Exactly one contribution per name sets it. */
  readonly signature?: unknown;
  readonly bindings: readonly GeneratorFunctionBinding[];
}

export interface GeneratorFunctionSummary {
  readonly name: string;
  readonly signature: unknown;
}

export type GeneratorFunctionResolution =
  | { readonly ok: true; readonly generator: ExecutionMutationDefaultValue }
  | { readonly ok: false; readonly reason: 'refused'; readonly message: string }
  | {
      readonly ok: false;
      readonly reason: 'unknown-function' | 'not-bound';
      readonly boundCodecIds: readonly string[];
    };

/** The call that produces a stored generator, and its PSL text, such as `uuid(7)`. */
export interface PrintedGeneratorCall {
  readonly call: GeneratorFunctionCall;
  readonly text: string;
}

export interface GeneratorFunctionRegistry {
  functionsFor(codecId: string): readonly GeneratorFunctionSummary[];
  has(name: string): boolean;
  resolve(call: GeneratorFunctionCall, field: GeneratorFunctionField): GeneratorFunctionResolution;
  callFor(
    generator: ExecutionMutationDefaultValue,
    field: GeneratorFunctionField,
  ): PrintedGeneratorCall | undefined;
}

/** A component that contributes generator functions, generator descriptors, or both. */
export interface GeneratorFunctionComponent {
  readonly id?: string;
  readonly generatorFunctions?: readonly GeneratorFunctionContribution[];
  readonly controlMutationDefaults?: {
    readonly generatorDescriptors: readonly MutationDefaultGeneratorDescriptor[];
  };
}

interface DeclaredFunction {
  readonly signature: unknown;
  readonly declaredBy: string;
}

interface OwnedBinding {
  readonly name: string;
  readonly binding: GeneratorFunctionBinding;
  readonly contributedBy: string;
}

function namedParametersOf(signature: unknown): readonly string[] {
  if (typeof signature !== 'object' || signature === null || !('named' in signature)) return [];
  const named: unknown = signature.named;
  return typeof named === 'object' && named !== null ? Object.keys(named) : [];
}

function invalidContribution(message: string): Error {
  return runtimeError('CONTRACT.PACK_CONTRIBUTION_INVALID', message);
}

/** A registered generator: its descriptor, and the id of the component that registers it. */
export interface GeneratorRegistration {
  readonly descriptor: MutationDefaultGeneratorDescriptor;
  readonly componentId: string | undefined;
}

/**
 * The generators the components register, by id. A generator registered by two components is refused: the component that defines a generator registers it, once.
 */
export function assembleGeneratorRegistrations(
  descriptors: ReadonlyArray<Pick<GeneratorFunctionComponent, 'id' | 'controlMutationDefaults'>>,
): ReadonlyMap<string, GeneratorRegistration> {
  const registered = new Map<string, GeneratorRegistration>();
  for (const component of descriptors) {
    for (const descriptor of component.controlMutationDefaults?.generatorDescriptors ?? []) {
      const existing = registered.get(descriptor.id);
      if (existing !== undefined) {
        throw invalidContribution(
          `Generator "${descriptor.id}" is registered by both "${existing.componentId ?? '<unknown>'}" and "${component.id ?? '<unknown>'}". Register each generator once, in the component that defines it.`,
        );
      }
      registered.set(descriptor.id, { descriptor, componentId: component.id });
    }
  }
  return registered;
}

/**
 * Assemble the generator functions of a composed stack: the control stack's components, or the pack refs of a TypeScript contract. Every generator a binding produces must be registered by a generator descriptor of one of the components.
 */
export function assembleGeneratorFunctions(
  descriptors: ReadonlyArray<GeneratorFunctionComponent>,
): GeneratorFunctionRegistry {
  const registered = assembleGeneratorRegistrations(descriptors);
  const declared = new Map<string, DeclaredFunction>();
  const bindingsByCodec = new Map<string, Map<string, OwnedBinding>>();
  const printersByCodecAndGenerator = new Map<string, OwnedBinding>();
  const contributed: OwnedBinding[] = [];

  for (const descriptor of descriptors) {
    const contributedBy = descriptor.id ?? '<unknown>';
    for (const contribution of descriptor.generatorFunctions ?? []) {
      if (contribution.signature !== undefined) {
        const [namedParameter] = namedParametersOf(contribution.signature);
        if (namedParameter !== undefined) {
          throw invalidContribution(
            `Generator function "${contribution.name}" from "${contributedBy}" declares the named parameter "${namedParameter}". A generator function takes positional parameters only, because a TypeScript gen call passes its arguments by position; declare it in positional.`,
          );
        }
        const existing = declared.get(contribution.name);
        if (existing !== undefined) {
          throw invalidContribution(
            `Generator function "${contribution.name}" is declared by both "${existing.declaredBy}" and "${contributedBy}".`,
          );
        }
        declared.set(contribution.name, {
          signature: contribution.signature,
          declaredBy: contributedBy,
        });
      }
      for (const binding of contribution.bindings) {
        contributed.push({ name: contribution.name, binding, contributedBy });
      }
    }
  }

  for (const owned of contributed) {
    if (!declared.has(owned.name)) {
      throw invalidContribution(
        `"${owned.contributedBy}" binds generator function "${owned.name}", which no component declares.`,
      );
    }
    for (const codecId of owned.binding.codecIds) {
      const forCodec = bindingsByCodec.get(codecId) ?? new Map<string, OwnedBinding>();
      const existing = forCodec.get(owned.name);
      if (existing !== undefined) {
        throw invalidContribution(
          `Generator function "${owned.name}" is bound to codec "${codecId}" by both "${existing.contributedBy}" and "${owned.contributedBy}".`,
        );
      }
      forCodec.set(owned.name, owned);
      bindingsByCodec.set(codecId, forCodec);

      for (const generatorId of owned.binding.generatorIds) {
        const key = `${codecId}\u0000${generatorId}`;
        const printer = printersByCodecAndGenerator.get(key);
        if (printer !== undefined && printer.name !== owned.name) {
          throw invalidContribution(
            `Generator "${generatorId}" on codec "${codecId}" is written by both function "${printer.name}" from "${printer.contributedBy}" and function "${owned.name}" from "${owned.contributedBy}".`,
          );
        }
        printersByCodecAndGenerator.set(key, owned);
      }
    }
    for (const generatorId of owned.binding.generatorIds) {
      if (!registered.has(generatorId)) {
        throw invalidContribution(
          `Generator function "${owned.name}" from "${owned.contributedBy}" produces generator "${generatorId}", which no generator descriptor in the stack registers.`,
        );
      }
    }
  }

  function boundCodecIdsOf(name: string): readonly string[] {
    return [...bindingsByCodec.entries()]
      .filter(([, forCodec]) => forCodec.has(name))
      .map(([codecId]) => codecId)
      .sort();
  }

  return {
    functionsFor(codecId) {
      return [...(bindingsByCodec.get(codecId)?.keys() ?? [])].sort().map((name) => ({
        name,
        signature: declared.get(name)?.signature,
      }));
    },
    has(name) {
      return declared.has(name);
    },
    resolve({ name, args }, field) {
      if (!declared.has(name)) {
        return { ok: false, reason: 'unknown-function', boundCodecIds: [] };
      }
      const owned = bindingsByCodec.get(field.codecId)?.get(name);
      if (owned === undefined) {
        return { ok: false, reason: 'not-bound', boundCodecIds: boundCodecIdsOf(name) };
      }
      const resolution = owned.binding.resolve({ args, field });
      if (!resolution.ok) return { ok: false, reason: 'refused', message: resolution.message };
      if (!owned.binding.generatorIds.includes(resolution.generator.id)) {
        throw new InternalError(
          `Generator function "${name}" from "${owned.contributedBy}" resolved to generator "${resolution.generator.id}", which its binding does not declare in generatorIds.`,
        );
      }
      return resolution;
    },
    callFor(generator, field) {
      const owned = printersByCodecAndGenerator.get(`${field.codecId}\u0000${generator.id}`);
      if (owned === undefined) return undefined;
      const printed = owned.binding.printArguments(generator, field);
      return printed === undefined
        ? undefined
        : {
            call: { name: owned.name, args: printed.args },
            text: `${owned.name}(${printed.text})`,
          };
    },
  };
}

/**
 * A binding of a function that takes no arguments to one generator, with params read from the field's type params when `paramsFromField` gives any.
 */
export function singleGeneratorBinding(input: {
  readonly codecIds: readonly string[];
  readonly generatorId: string;
  readonly paramsFromField?: (
    field: GeneratorFunctionField,
  ) => Readonly<Record<string, unknown>> | undefined;
}): GeneratorFunctionBinding {
  return {
    codecIds: input.codecIds,
    generatorIds: [input.generatorId],
    resolve: ({ field }) => {
      const params = input.paramsFromField?.(field);
      return {
        ok: true,
        generator:
          params === undefined
            ? { kind: 'generator', id: input.generatorId }
            : { kind: 'generator', id: input.generatorId, params },
      };
    },
    printArguments: (generator) =>
      generator.id === input.generatorId ? { args: {}, text: '' } : undefined,
  };
}

/** The generator functions of a stack that contributes none. */
export const EMPTY_GENERATOR_FUNCTIONS: GeneratorFunctionRegistry = assembleGeneratorFunctions([]);
