import type {
  ContractExecutionSection,
  ExecutionMutationDefault,
  ExecutionMutationDefaultValue,
} from '@internal/contract/types';
import {
  createExecutionStack,
  type ExecutionStack,
  type RuntimeAdapterDescriptor,
  type RuntimeAdapterInstance,
  type RuntimeDriverDescriptor,
  type RuntimeDriverInstance,
  type RuntimeExtensionDescriptor,
  type RuntimeExtensionInstance,
  type RuntimeTargetDescriptor,
  type RuntimeTargetInstance,
} from '@internal/framework-components/execution';
import { runtimeError } from '@internal/framework-components/runtime';
import type { MongoCodec } from '@internal/mongo-codec';
import { type MongoCodecRegistry, newMongoCodecRegistry } from '@internal/mongo-codec';
import type {
  MongoAppliedMutationDefault,
  MongoMutationDefaults,
  MongoMutationDefaultsOptions,
} from '@internal/mongo-contract';
import type { MongoAdapter } from '@internal/mongo-lowering';
import { assertDefined } from '@internal/utils/assertions';
import { blindCast } from '@internal/utils/casts';

/**
 * Scope across which a generator's value is constant: `'field'` one value per defaulted field, `'row'` one value per document of one call, `'query'` one value per ORM operation (through the caller's `defaultValueCache`).
 */
export type MongoGeneratorStability = 'field' | 'row' | 'query';

export interface MongoRuntimeMutationDefaultGenerator {
  readonly id: string;
  readonly generate: (params?: Record<string, unknown>) => unknown;
  readonly stability: MongoGeneratorStability;
}

/**
 * Mongo-specific static contributions a runtime descriptor declares.
 *
 * Mirrors `SqlStaticContributions` in shape: a `codecs()` getter that yields a `MongoCodecRegistry` populated with this contributor's codecs. The registry is then walked by `createMongoExecutionContext` and folded into the single per-execution registry the runtime reads from at decode time.
 */
export interface MongoStaticContributions {
  readonly codecs: () => MongoCodecRegistry;
  readonly mutationDefaultGenerators?: () => ReadonlyArray<MongoRuntimeMutationDefaultGenerator>;
}

export interface MongoRuntimeTargetDescriptor<
  TTargetId extends string = 'mongo',
  TTargetInstance extends RuntimeTargetInstance<'mongo', TTargetId> = RuntimeTargetInstance<
    'mongo',
    TTargetId
  >,
> extends RuntimeTargetDescriptor<'mongo', TTargetId, TTargetInstance>,
    MongoStaticContributions {}

export interface MongoRuntimeAdapterInstance<TTargetId extends string = 'mongo'>
  extends RuntimeAdapterInstance<'mongo', TTargetId>,
    MongoAdapter {}

export interface MongoRuntimeAdapterDescriptor<
  TTargetId extends string = 'mongo',
  TAdapterInstance extends RuntimeAdapterInstance<
    'mongo',
    TTargetId
  > = MongoRuntimeAdapterInstance<TTargetId>,
> extends RuntimeAdapterDescriptor<'mongo', TTargetId, TAdapterInstance>,
    MongoStaticContributions {}

export interface MongoRuntimeExtensionInstance<TTargetId extends string = 'mongo'>
  extends RuntimeExtensionInstance<'mongo', TTargetId> {}

export interface MongoRuntimeExtensionDescriptor<TTargetId extends string = 'mongo'>
  extends RuntimeExtensionDescriptor<'mongo', TTargetId, MongoRuntimeExtensionInstance<TTargetId>>,
    MongoStaticContributions {
  create(): MongoRuntimeExtensionInstance<TTargetId>;
}

/**
 * The Mongo execution stack: target + adapter + optional driver + extension packs. Mirrors `SqlExecutionStack`. Constructed via `createMongoExecutionStack`.
 */
export interface MongoExecutionStack<TTargetId extends string = 'mongo'> {
  readonly target: MongoRuntimeTargetDescriptor<TTargetId>;
  readonly adapter: MongoRuntimeAdapterDescriptor<TTargetId>;
  readonly driver:
    | RuntimeDriverDescriptor<
        'mongo',
        TTargetId,
        unknown,
        RuntimeDriverInstance<'mongo', TTargetId>
      >
    | undefined;
  readonly extensions: readonly MongoRuntimeExtensionDescriptor<TTargetId>[];
}

export function createMongoExecutionStack<TTargetId extends string = 'mongo'>(options: {
  readonly target: MongoRuntimeTargetDescriptor<TTargetId>;
  readonly adapter: MongoRuntimeAdapterDescriptor<TTargetId>;
  readonly driver?:
    | RuntimeDriverDescriptor<
        'mongo',
        TTargetId,
        unknown,
        RuntimeDriverInstance<'mongo', TTargetId>
      >
    | undefined;
  readonly extensions?: readonly MongoRuntimeExtensionDescriptor<TTargetId>[] | undefined;
}): MongoExecutionStack<TTargetId> {
  const stack = createExecutionStack({
    target: options.target,
    adapter: options.adapter,
    driver: options.driver,
    extensions: options.extensions,
  });
  return stack as ExecutionStack<'mongo', TTargetId> as MongoExecutionStack<TTargetId>;
}

/**
 * Read-only view of the codec registry exposed on `MongoExecutionContext`.
 *
 * Hides `register()` and the iterator from public surface — users do not mutate the per-execution codec registry. Internal aggregation in `createMongoExecutionContext` keeps using the full `MongoCodecRegistry` (it needs `register()`).
 */
export interface MongoCodecLookup {
  get(id: string): MongoCodec<string> | undefined;
  has(id: string): boolean;
}

/**
 * Per-execution context aggregated from a `MongoExecutionStack`.
 *
 * Carries the user's contract, a read-only lookup over the codec registry composed from every stack contributor, a back-reference to the stack itself so the runtime can reach the adapter without users threading it explicitly, and `applyMutationDefaults`, which fills the contract's execution defaults from the composed generators.
 *
 * Mirrors SQL's `ExecutionContext` in role; Mongo's flavour is leaner because there are no parameterised codecs or JSON-schema validators in scope yet.
 */
export interface MongoExecutionContext<TContract = unknown, TTargetId extends string = 'mongo'>
  extends MongoMutationDefaults {
  readonly contract: TContract;
  readonly codecs: MongoCodecLookup;
  readonly stack: MongoExecutionStack<TTargetId>;
}

export function createMongoExecutionContext<
  TContract = unknown,
  TTargetId extends string = 'mongo',
>(options: {
  readonly contract: TContract;
  readonly stack: MongoExecutionStack<TTargetId>;
}): MongoExecutionContext<TContract, TTargetId> {
  const registry = newMongoCodecRegistry();
  const owners = new Map<string, string>();

  const contributors: ReadonlyArray<MongoStaticContributions & { readonly id: string }> = [
    options.stack.target,
    options.stack.adapter,
    ...options.stack.extensions,
  ];

  const generators = collectMutationDefaultGenerators(contributors);
  const executionDefaults = executionDefaultsOf(options.contract);
  assertMutationDefaultGeneratorsAvailable(executionDefaults, generators);

  for (const contributor of contributors) {
    const contributed = contributor.codecs();
    for (const codec of iterateCodecs(contributed)) {
      const existingOwner = owners.get(codec.id);
      if (existingOwner !== undefined) {
        throw runtimeError(
          'RUNTIME.DUPLICATE_CODEC',
          `Duplicate Mongo codec id '${codec.id}' contributed by '${contributor.id}' (already registered by '${existingOwner}').`,
          { codecId: codec.id, existingOwner, incomingOwner: contributor.id },
        );
      }
      registry.register(codec);
      owners.set(codec.id, contributor.id);
    }
  }

  return Object.freeze({
    contract: options.contract,
    codecs: registry,
    stack: options.stack,
    applyMutationDefaults: (mutation: MongoMutationDefaultsOptions) =>
      applyMutationDefaults(executionDefaults, generators, mutation),
  });
}

function executionDefaultsOf(contract: unknown): readonly ExecutionMutationDefault[] {
  return (
    blindCast<
      { readonly execution?: ContractExecutionSection } | null | undefined,
      'the execution context receives a validated contract, whose execution section (when present) has the framework shape'
    >(contract)?.execution?.mutations.defaults ?? []
  );
}

function collectMutationDefaultGenerators(
  contributors: ReadonlyArray<MongoStaticContributions & { readonly id: string }>,
): ReadonlyMap<string, MongoRuntimeMutationDefaultGenerator> {
  const generators = new Map<string, MongoRuntimeMutationDefaultGenerator>();
  const owners = new Map<string, string>();
  for (const contributor of contributors) {
    for (const generator of contributor.mutationDefaultGenerators?.() ?? []) {
      const existingOwner = owners.get(generator.id);
      if (existingOwner !== undefined) {
        throw runtimeError(
          'RUNTIME.DUPLICATE_MUTATION_DEFAULT_GENERATOR',
          `Duplicate mutation default generator '${generator.id}'.`,
          { id: generator.id, existingOwner, incomingOwner: contributor.id },
        );
      }
      generators.set(generator.id, generator);
      owners.set(generator.id, contributor.id);
    }
  }
  return generators;
}

function assertMutationDefaultGeneratorsAvailable(
  defaults: readonly ExecutionMutationDefault[],
  generators: ReadonlyMap<string, MongoRuntimeMutationDefaultGenerator>,
): void {
  const missing = new Set<string>();
  for (const mutationDefault of defaults) {
    for (const phase of [mutationDefault.onCreate, mutationDefault.onUpdate]) {
      if (phase?.kind === 'generator' && !generators.has(phase.id)) {
        missing.add(phase.id);
      }
    }
  }
  if (missing.size === 0) return;
  const ids = Array.from(missing);
  throw runtimeError(
    'RUNTIME.MUTATION_DEFAULT_GENERATOR_MISSING',
    `Contract requires mutation default generator(s) ${ids.map((id) => `'${id}'`).join(', ')}, but no runtime component provides them.`,
    { ids },
  );
}

function definedKeys(values: Readonly<Record<string, unknown>>): ReadonlySet<string> {
  return new Set(Object.keys(values).filter((key) => values[key] !== undefined));
}

function applyMutationDefaults(
  defaults: readonly ExecutionMutationDefault[],
  generators: ReadonlyMap<string, MongoRuntimeMutationDefaultGenerator>,
  options: MongoMutationDefaultsOptions,
): ReadonlyArray<MongoAppliedMutationDefault> {
  const explicitFields = definedKeys(options.values);
  if (options.op === 'update' && explicitFields.size === 0) {
    return [];
  }

  const applied: MongoAppliedMutationDefault[] = [];
  const appliedFields = new Set<string>();
  const rowCache = new Map<string, unknown>();
  for (const mutationDefault of defaults) {
    const { namespace, entry, field } = mutationDefault.ref;
    if (namespace !== options.namespace || entry !== options.entry) continue;
    const spec = options.op === 'create' ? mutationDefault.onCreate : mutationDefault.onUpdate;
    if (!spec || explicitFields.has(field) || appliedFields.has(field)) continue;
    applied.push({
      field,
      value: generateScoped(spec, generators, rowCache, options.defaultValueCache),
    });
    appliedFields.add(field);
  }
  return applied;
}

function generateScoped(
  spec: ExecutionMutationDefaultValue,
  generators: ReadonlyMap<string, MongoRuntimeMutationDefaultGenerator>,
  rowCache: Map<string, unknown>,
  queryCache: Map<string, unknown> | undefined,
): unknown {
  const generator = generators.get(spec.id);
  assertDefined(
    generator,
    `mutation default generator '${spec.id}' is registered: createMongoExecutionContext checks every generator the contract names`,
  );
  const cache =
    generator.stability === 'row'
      ? rowCache
      : generator.stability === 'query'
        ? queryCache
        : undefined;
  if (cache?.has(spec.id)) {
    return cache.get(spec.id);
  }
  // nosemgrep: javascript.express.security.express-wkhtml-injection.express-wkhtmltoimage-injection
  const value = generator.generate(spec.params);
  cache?.set(spec.id, value);
  return value;
}

function* iterateCodecs(registry: MongoCodecRegistry): Iterable<MongoCodec<string>> {
  yield* registry.values();
}
