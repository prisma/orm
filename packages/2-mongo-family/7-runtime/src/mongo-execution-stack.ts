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
  type MutationDefaultGeneratorContributor,
  type MutationDefaultsOptions,
  runtimeError,
} from '@internal/framework-components/runtime';
import type { MongoCodec } from '@internal/mongo-codec';
import { type MongoCodecRegistry, newMongoCodecRegistry } from '@internal/mongo-codec';
import type { MongoContract } from '@internal/mongo-contract';
import type { MongoAdapter, MongoDriver } from '@internal/mongo-lowering';
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
 * The Mongo execution stack: target + adapter + extension packs. Mirrors `SqlExecutionStack`. Constructed via `createMongoExecutionStack`; given a driver, it returns a {@link MongoExecutionStackWithDriver}.
 */
export interface MongoExecutionStack<TTargetId extends string = 'mongo'> {
  readonly target: MongoRuntimeTargetDescriptor<TTargetId>;
  readonly adapter: MongoRuntimeAdapterDescriptor<TTargetId>;
  readonly extensions: readonly MongoRuntimeExtensionDescriptor<TTargetId>[];
}

/**
 * The binding type is erased to `unknown` here, as in `SqlRuntimeDriverInstance`. A target client such as `mongo()` resolves the concrete binding before it calls `driver.connect(binding)`.
 */
export type MongoRuntimeDriverInstance<TTargetId extends string = 'mongo'> = RuntimeDriverInstance<
  'mongo',
  TTargetId
> &
  MongoDriver<unknown>;

export type MongoExecutionStackWithDriver<TTargetId extends string = 'mongo'> =
  MongoExecutionStack<TTargetId> & {
    readonly driver: RuntimeDriverDescriptor<
      'mongo',
      TTargetId,
      unknown,
      MongoRuntimeDriverInstance<TTargetId>
    >;
  };

interface MongoExecutionStackOptions<TTargetId extends string> {
  readonly target: MongoRuntimeTargetDescriptor<TTargetId>;
  readonly adapter: MongoRuntimeAdapterDescriptor<TTargetId>;
  readonly extensions?: readonly MongoRuntimeExtensionDescriptor<TTargetId>[] | undefined;
}

export function createMongoExecutionStack<TTargetId extends string = 'mongo'>(
  options: MongoExecutionStackOptions<TTargetId> & {
    readonly driver: MongoExecutionStackWithDriver<TTargetId>['driver'];
  },
): MongoExecutionStackWithDriver<TTargetId>;
export function createMongoExecutionStack<TTargetId extends string = 'mongo'>(
  options: MongoExecutionStackOptions<TTargetId>,
): MongoExecutionStack<TTargetId>;
export function createMongoExecutionStack<TTargetId extends string = 'mongo'>(
  options: MongoExecutionStackOptions<TTargetId> & {
    readonly driver?: MongoExecutionStackWithDriver<TTargetId>['driver'];
  },
): MongoExecutionStack<TTargetId> | MongoExecutionStackWithDriver<TTargetId> {
  const { target, adapter, driver, extensions } = createExecutionStack({
    target: options.target,
    adapter: options.adapter,
    driver: options.driver,
    extensions: options.extensions,
  });
  return driver === undefined
    ? { target, adapter, extensions }
    : { target, adapter, driver, extensions };
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
