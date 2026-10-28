import type {
  AnyMongoTypeMaps,
  MongoContract,
  MongoContractWithTypeMaps,
  RootModelName,
} from '@internal/mongo-contract';
import type { MongoExecutionContext } from '@internal/mongo-query-ast/execution';
import { blindCast } from '@internal/utils/casts';
import type { MongoCollection } from './collection';
import { createMongoCollection } from './collection';
import type { MongoQueryExecutor } from './executor';

export interface MongoOrmOptions<TContract extends MongoContract> {
  /** The validated contract, its codecs, and the execution defaults filled on writes. */
  readonly context: MongoExecutionContext<TContract>;
  readonly runtime: MongoQueryExecutor;
}

export type MongoOrmClient<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
> = {
  readonly [K in keyof TContract['roots'] & string]: MongoCollection<
    TContract,
    RootModelName<TContract, K>
  >;
};

export function mongoOrm<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
>(options: MongoOrmOptions<TContract>): MongoOrmClient<TContract> {
  const { context, runtime } = options;
  const client: Record<string, unknown> = {};

  for (const [rootName, rootRef] of Object.entries(context.contract.roots)) {
    client[rootName] = createMongoCollection(
      { context, runtime },
      blindCast<
        RootModelName<TContract, typeof rootName & keyof TContract['roots'] & string>,
        'roots entries are CrossReferences; rootRef.model is a valid RootModelName for this contract'
      >(rootRef.model),
    );
  }

  return blindCast<
    MongoOrmClient<TContract>,
    'the client holds a collection for every root the contract names'
  >(client);
}
