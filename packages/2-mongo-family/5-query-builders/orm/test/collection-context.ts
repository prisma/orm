import type { MutationDefaults } from '@internal/framework-components/runtime';
import type { MongoContract } from '@internal/mongo-contract';
import type { MongoExecutionContext } from '@internal/mongo-query-ast/execution';
import type { MongoCollectionContext } from '../src/collection';
import type { MongoQueryExecutor } from '../src/executor';

const noCodecs = { get: () => undefined, has: () => false };
const noMutationDefaults: MutationDefaults = { applyMutationDefaults: () => [] };

/** An execution context over a contract without enums, with no codecs and the given mutation defaults. */
export function contextOf<TContract extends MongoContract>(
  contract: TContract,
  mutationDefaults: MutationDefaults = noMutationDefaults,
): MongoExecutionContext<TContract> {
  return {
    contract,
    codecs: noCodecs,
    applyMutationDefaults: (options) => mutationDefaults.applyMutationDefaults(options),
  };
}

/** A collection context over a contract without enums. */
export function collectionContext<TContract extends MongoContract>(
  contract: TContract,
  runtime: MongoQueryExecutor,
  mutationDefaults?: MutationDefaults,
): MongoCollectionContext<TContract> {
  return { context: contextOf(contract, mutationDefaults), runtime };
}
