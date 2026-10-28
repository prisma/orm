import type { MongoContract } from '@internal/mongo-contract';
import type { MongoExecutionContext } from '@internal/mongo-query-ast/execution';

export function contextOf<TContract extends MongoContract>(
  contract: TContract,
): MongoExecutionContext<TContract> {
  return {
    contract,
    codecs: { get: () => undefined, has: () => false },
    applyMutationDefaults: () => [],
  };
}
