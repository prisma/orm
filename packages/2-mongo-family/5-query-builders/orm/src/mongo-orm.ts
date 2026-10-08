import type { MutationDefaults } from '@internal/framework-components/runtime';
import type {
  AnyMongoTypeMaps,
  MongoContract,
  MongoContractWithTypeMaps,
  RootModelName,
} from '@internal/mongo-contract';
import { blindCast } from '@internal/utils/casts';
import type { MongoCollection, MongoOrmEnums } from './collection';
import { createMongoCollection } from './collection';
import type { MongoQueryExecutor } from './executor';
import { ormError } from './orm-errors';

export interface MongoOrmOptions<TContract extends MongoContract> {
  readonly contract: TContract;
  readonly executor: MongoQueryExecutor;
  /** Fills the contract's execution defaults on writes. Without it, no generated values are applied. */
  readonly mutationDefaults?: MutationDefaults;
  /** The contract's enum accessors, which a written enum value is checked against: `buildMongoEnums(contract, context.codecs)`, the accessors `db.enums` holds. */
  readonly enums: MongoOrmEnums;
}

export type MongoOrmClient<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
> = {
  readonly [K in keyof TContract['roots'] & string]: MongoCollection<
    TContract,
    RootModelName<TContract, K>
  >;
};

function assertEnumsComplete(contract: MongoContract, enums: MongoOrmEnums): void {
  for (const [namespaceId, namespace] of Object.entries(contract.domain.namespaces)) {
    const accessors = enums[namespaceId] ?? {};
    for (const enumName of Object.keys(namespace.enum ?? {})) {
      if (enumName in accessors) continue;
      throw ormError(
        'ORM.ARGUMENT_INVALID',
        `mongoOrm() has no accessor for enum ${enumName} in namespace ${namespaceId}, so it cannot check a value written to a field of that enum. Pass the contract's enum accessors: enums: buildMongoEnums(contract, context.codecs).`,
        { meta: { argument: 'enums', namespace: namespaceId, enum: enumName } },
      );
    }
  }
}

export function mongoOrm<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
>(options: MongoOrmOptions<TContract>): MongoOrmClient<TContract> {
  const { contract, executor, mutationDefaults, enums } = options;
  const executionDefaults = contract.execution?.mutations.defaults ?? [];
  if (executionDefaults.length > 0 && mutationDefaults === undefined) {
    throw ormError(
      'ORM.MUTATION_DEFAULTS_MISSING',
      'The contract has execution defaults (fields such as temporal.createdAt() that the ORM fills on write), but mongoOrm() was built without mutationDefaults, so those fields would never be written. Pass the execution context: mongoOrm({ contract, executor, mutationDefaults: context }), or create the client with mongo().',
      { meta: { fields: executionDefaults.map((d) => `${d.ref.entry}.${d.ref.field}`) } },
    );
  }
  assertEnumsComplete(contract, enums);
  const client: Record<string, unknown> = {};

  for (const [rootName, rootRef] of Object.entries(contract.roots)) {
    client[rootName] = createMongoCollection(
      contract,
      blindCast<
        RootModelName<TContract, typeof rootName & keyof TContract['roots'] & string>,
        'roots entries are CrossReferences; rootRef.model is a valid RootModelName for this contract'
      >(rootRef.model),
      executor,
      enums,
      mutationDefaults,
    );
  }

  return blindCast<
    MongoOrmClient<TContract>,
    'the client holds a collection for every root the contract names'
  >(client);
}
