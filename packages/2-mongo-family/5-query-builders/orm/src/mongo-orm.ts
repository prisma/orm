import type {
  AnyMongoTypeMaps,
  MongoContract,
  MongoContractWithTypeMaps,
  MongoMutationDefaults,
  RootModelName,
} from '@internal/mongo-contract';
import { blindCast } from '@internal/utils/casts';
import type { MongoCollection } from './collection';
import { createMongoCollection } from './collection';
import type { MongoQueryExecutor } from './executor';
import { ormError } from './orm-errors';

export interface MongoOrmOptions<TContract extends MongoContract> {
  readonly contract: TContract;
  readonly executor: MongoQueryExecutor;
  /** Fills the contract's execution defaults on writes. Without it, no generated values are applied. */
  readonly mutationDefaults?: MongoMutationDefaults;
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
  const { contract, executor, mutationDefaults } = options;
  const executionDefaults = contract.execution?.mutations.defaults ?? [];
  if (executionDefaults.length > 0 && mutationDefaults === undefined) {
    throw ormError(
      'ORM.MUTATION_DEFAULTS_MISSING',
      'The contract has execution defaults (fields such as temporal.createdAt() that the ORM fills on write), but mongoOrm() was built without mutationDefaults, so those fields would never be written. Pass the execution context: mongoOrm({ contract, executor, mutationDefaults: context }), or create the client with mongo().',
      { meta: { fields: executionDefaults.map((d) => `${d.ref.entry}.${d.ref.field}`) } },
    );
  }
  const client: Record<string, unknown> = {};

  for (const [rootName, rootRef] of Object.entries(contract.roots)) {
    client[rootName] = createMongoCollection(
      contract,
      blindCast<
        RootModelName<TContract, typeof rootName & keyof TContract['roots'] & string>,
        'roots entries are CrossReferences; rootRef.model is a valid RootModelName for this contract'
      >(rootRef.model),
      executor,
      mutationDefaults,
    );
  }

  return client as MongoOrmClient<TContract>;
}
