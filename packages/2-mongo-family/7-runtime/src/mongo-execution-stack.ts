import type { ContractExecutionSection } from '@internal/contract/types';
import {
  createExecutionStack,
  type RuntimeAdapterDescriptor,
  type RuntimeAdapterInstance,
  type RuntimeDriverDescriptor,
  type RuntimeDriverInstance,
  type RuntimeExtensionDescriptor,
  type RuntimeExtensionInstance,
  type RuntimeTargetDescriptor,
  type RuntimeTargetInstance,
} from '@internal/framework-components/execution';
import {
  applyMutationDefaults,
  assertMutationDefaultGeneratorsAvailable,
  collectMutationDefaultGenerators,
  type MutationDefaults,
  type MutationDefaultsOptions,
  type RuntimeMutationDefaultGenerator,
  runtimeError,
} from '@internal/framework-components/runtime';
import type { MongoCodec } from '@internal/mongo-codec';
import { type MongoCodecRegistry, newMongoCodecRegistry } from '@internal/mongo-codec';
import type { MongoAdapter } from '@internal/mongo-lowering';
import { blindCast } from '@internal/utils/casts';

/**
 * Mongo-specific static contributions a runtime descriptor declares.
 *
 * Mirrors `SqlStaticContributions` in shape: a `codecs()` getter that yields a `MongoCodecRegistry` populated with this contributor's codecs. The registry is then walked by `createMongoExecutionContext` and folded into the single per-execution registry the runtime reads from at decode time.
 */
export interface MongoStaticContributions {
  readonly codecs: () => MongoCodecRegistry;
  readonly mutationDefaultGenerators?: () => ReadonlyArray<RuntimeMutationDefaultGenerator>;
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
  return blindCast<
    MongoExecutionStack<TTargetId>,
    'createExecutionStack keeps the Mongo descriptors it was given'
  >(stack);
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
  extends MutationDefaults {
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
  const execution = executionOf(options.contract);
  assertMutationDefaultGeneratorsAvailable(execution, generators);

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
    applyMutationDefaults: (mutation: MutationDefaultsOptions) =>
      applyMutationDefaults(execution, generators, mutation),
  });
}

function executionOf(contract: unknown): ContractExecutionSection | undefined {
  return blindCast<
    { readonly execution?: ContractExecutionSection } | null | undefined,
    'the execution context receives a validated contract, whose execution section (when present) has the framework shape'
  >(contract)?.execution;
}

function* iterateCodecs(registry: MongoCodecRegistry): Iterable<MongoCodec<string>> {
  yield* registry.values();
}
