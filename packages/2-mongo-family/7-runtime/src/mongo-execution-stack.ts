import { checkContractComponentRequirements } from '@internal/framework-components/components';
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
import { assembleMongoCodecRegistry, type MongoCodecContributor } from '@internal/mongo-codec';
import type { MongoContract } from '@internal/mongo-contract';
import type { MongoAdapter, MongoDriver } from '@internal/mongo-lowering';
import type { MongoExecutionContext } from '@internal/mongo-query-ast/execution';

/**
 * Mongo-specific static contributions a runtime descriptor declares. Codecs are not among them: a descriptor declares its codecs once, as codec descriptors in `types.codecTypes.codecDescriptors`, which `createMongoExecutionContext` and the adapter both read with `assembleMongoCodecRegistry`.
 */
export interface MongoStaticContributions
  extends Pick<MutationDefaultGeneratorContributor, 'mutationDefaultGenerators'> {}

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
  assertMongoExecutionStackContractRequirements(options.contract, options.stack);

  const contributors: ReadonlyArray<MongoStaticContributions & MongoCodecContributor> = [
    options.stack.target,
    options.stack.adapter,
    ...options.stack.extensions,
  ];

  const generators = collectMutationDefaultGenerators(contributors);
  const execution = options.contract.execution;
  assertMutationDefaultGeneratorsAvailable(execution, generators);

  const registry = assembleMongoCodecRegistry(contributors);

  return Object.freeze({
    contract: options.contract,
    codecs: registry,
    applyMutationDefaults: (mutation: MutationDefaultsOptions) =>
      applyMutationDefaults(execution, generators, mutation),
  });
}

function assertMongoExecutionStackContractRequirements<TTargetId extends string>(
  contract: MongoContract,
  stack: MongoExecutionStack<TTargetId>,
): void {
  const result = checkContractComponentRequirements({
    contract,
    expectedTargetFamily: 'mongo',
    expectedTargetId: stack.target.targetId,
    providedComponentIds: [
      stack.target.id,
      stack.adapter.id,
      ...stack.extensions.map((pack) => pack.id),
    ],
  });

  if (result.familyMismatch) {
    throw runtimeError(
      'RUNTIME.CONTRACT_FAMILY_MISMATCH',
      `Contract target family '${result.familyMismatch.actual}' does not match runtime family '${result.familyMismatch.expected}'.`,
      { actual: result.familyMismatch.actual, expected: result.familyMismatch.expected },
    );
  }

  if (result.targetMismatch) {
    throw runtimeError(
      'RUNTIME.CONTRACT_TARGET_MISMATCH',
      `Contract target '${result.targetMismatch.actual}' does not match runtime target descriptor '${result.targetMismatch.expected}'.`,
      { actual: result.targetMismatch.actual, expected: result.targetMismatch.expected },
    );
  }

  if (result.missingExtensionPackIds.length > 0) {
    const packIds = result.missingExtensionPackIds;
    const packList = packIds.map((id) => `'${id}'`).join(', ');
    throw runtimeError(
      'RUNTIME.MISSING_EXTENSION_PACK',
      `Contract requires extension pack(s) ${packList}, but runtime descriptors do not provide matching component(s).`,
      { packIds },
    );
  }
}
