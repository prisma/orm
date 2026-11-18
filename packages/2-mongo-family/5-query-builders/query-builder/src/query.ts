import type { PlanMeta } from '@internal/contract/types';
import type {
  AnyMongoTypeMaps,
  MongoContract,
  MongoContractWithTypeMaps,
  RootModelName,
} from '@internal/mongo-contract';
import type {
  AnyMongoCommand,
  MongoExecutionContext,
  MongoQueryPlan,
} from '@internal/mongo-query-ast/execution';
import { contractError } from './contract-errors';
import { asMongoContract, type CollectionHandle, createCollectionHandle } from './state-classes';

/**
 * Public entry point of the query builder. `mongoQuery(...).from(rootName)`
 * yields the root state of the three-state machine
 * (`CollectionHandle` → `FilteredCollection` → `PipelineChain`).
 *
 * `rawCommand(cmd)` is the escape hatch for cases the typed surface does
 * not cover (yet) — it accepts any `AnyMongoCommand` (typed CRUD or a
 * `RawMongoCommand` of `Document`s) and packages it into a `MongoQueryPlan`
 * with `lane: 'mongo-query'`. Row type is `unknown` because the runtime
 * cannot know what the caller's command yields.
 */
export interface QueryRoot<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
> {
  from<K extends keyof TContract['roots'] & string>(
    rootName: K,
  ): CollectionHandle<TContract, RootModelName<TContract, K>>;
  rawCommand<C extends AnyMongoCommand>(command: C): MongoQueryPlan<unknown, C>;
}

/** Builds queries for the contract of `context`, which `mongoStatic({ contract })` and `mongo({ contract })` create after validating the contract. */
export function mongoQuery<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
>(options: { readonly context: MongoExecutionContext<TContract> }): QueryRoot<TContract> {
  const { contract } = options.context;
  return {
    from<K extends keyof TContract['roots'] & string>(rootName: K) {
      return createCollectionHandle(contract, rootName);
    },
    rawCommand<C extends AnyMongoCommand>(command: C): MongoQueryPlan<unknown, C> {
      const c = asMongoContract(contract);
      const storageHash = c.storage?.storageHash;
      if (!storageHash) {
        throw contractError(
          'CONTRACT.VALIDATION_FAILED',
          'Contract is missing storage.storageHash. Pass a validated contract to mongoQuery().',
        );
      }
      const meta: PlanMeta = {
        target: 'mongo',
        storageHash: String(storageHash),
        lane: 'mongo-query',
      };
      return { collection: command.collection, command, meta };
    },
  };
}
