import {
  createExecutionStack,
  type RuntimeAdapterDescriptor,
  type RuntimeAdapterInstance,
  type RuntimeExtensionDescriptor,
  type RuntimeExtensionInstance,
  type RuntimeTargetDescriptor,
  type RuntimeTargetInstance,
} from '@internal/framework-components/execution';
import {
  applyMutationDefaults,
  assertMutationDefaultGeneratorsAvailable,
  collectMutationDefaultGenerators,
  type MutationDefaultGeneratorContributor,
  type MutationDefaultsOptions,
  runtimeError,
} from '@internal/framework-components/runtime';
import type { MongoCodec } from '@internal/mongo-codec';
import { type MongoCodecRegistry, newMongoCodecRegistry } from '@internal/mongo-codec';
import type { MongoContract } from '@internal/mongo-contract';
import type { MongoAdapter } from '@internal/mongo-lowering';
import type { MongoExecutionContext } from '@internal/mongo-query-ast/execution';

/**
 * Mongo-specific static contributions a runtime descriptor declares.
 *
 * Mirrors `SqlStaticContributions` in shape: a `codecs()` getter that yields a `MongoCodecRegistry` populated with this contributor's codecs. The registry is then walked by `createMongoExecutionContext` and folded into the single per-execution registry the runtime reads from at decode time.
 */
export interface MongoStaticContributions
  extends Pick<MutationDefaultGeneratorContributor, 'mutationDefaultGenerators'> {
  readonly codecs: () => MongoCodecRegistry;
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
 * The Mongo execution stack: target + adapter + extension packs. Mirrors `SqlExecutionStack`. Constructed via `createMongoExecutionStack`.
 */
export interface MongoExecutionStack<TTargetId extends string = 'mongo'> {
  readonly target: MongoRuntimeTargetDescriptor<TTargetId>;
  readonly adapter: MongoRuntimeAdapterDescriptor<TTargetId>;
  readonly extensions: readonly MongoRuntimeExtensionDescriptor<TTargetId>[];
}

export function createMongoExecutionStack<TTargetId extends string = 'mongo'>(options: {
  readonly target: MongoRuntimeTargetDescriptor<TTargetId>;
  readonly adapter: MongoRuntimeAdapterDescriptor<TTargetId>;
  readonly extensions?: readonly MongoRuntimeExtensionDescriptor<TTargetId>[] | undefined;
}): MongoExecutionStack<TTargetId> {
  const { target, adapter, extensions } = createExecutionStack({
    target: options.target,
    adapter: options.adapter,
    extensions: options.extensions,
  });
  return { target, adapter, extensions };
}

export function createMongoExecutionContext<
  TContract extends MongoContract = MongoContract,
  TTargetId extends string = 'mongo',
>(options: {
  readonly contract: TContract;
  readonly stack: MongoExecutionStack<TTargetId>;
}): MongoExecutionContext<TContract> {
  const registry = newMongoCodecRegistry();
  const owners = new Map<string, string>();

  const contributors: ReadonlyArray<MongoStaticContributions & { readonly id: string }> = [
    options.stack.target,
    options.stack.adapter,
    ...options.stack.extensions,
  ];

  const generators = collectMutationDefaultGenerators(contributors);
  const execution = options.contract.execution;
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
    applyMutationDefaults: (mutation: MutationDefaultsOptions) =>
      applyMutationDefaults(execution, generators, mutation),
  });
}

function* iterateCodecs(registry: MongoCodecRegistry): Iterable<MongoCodec<string>> {
  yield* registry.values();
}
