import mongoRuntimeAdapter from '@internal/adapter-mongo/runtime';
import type { NamespacedEnums } from '@internal/contract/enum-accessor';
import { MongoContractSerializer } from '@internal/family-mongo/ir';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type {
  AnyMongoTypeMaps,
  MongoContract,
  MongoContractWithTypeMaps,
} from '@internal/mongo-contract';
import type { MongoRawClient } from '@internal/mongo-orm';
import { mongoRaw } from '@internal/mongo-orm';
import { mongoQuery } from '@internal/mongo-query-builder';
import {
  buildMongoEnums,
  createMongoExecutionContext,
  createMongoExecutionStack,
  type MongoEnumAccessors,
  type MongoExecutionContext,
} from '@internal/mongo-runtime';
import mongoRuntimeTarget from '@internal/target-mongo/runtime';
import { assertDefined } from '@internal/utils/assertions';
import { blindCast } from '@internal/utils/casts';

type UnboundEnums<TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>> =
  NamespacedEnums<TContract>[typeof UNBOUND_NAMESPACE_ID];

export interface MongoStaticContext<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
> {
  readonly context: MongoExecutionContext<TContract>;
  readonly contract: TContract;
  readonly enums: UnboundEnums<TContract>;
  readonly query: ReturnType<typeof mongoQuery<TContract>>;
  readonly raw: MongoRawClient<TContract>;
}

/** A {@link MongoStaticContext} with the enum accessors of every namespace, which `mongo()` hands its ORM. */
export interface MongoClientStaticContext<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
> extends MongoStaticContext<TContract> {
  readonly enumsByNamespace: MongoEnumAccessors;
}

export function buildMongoStaticContext<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
>(contract: TContract): MongoClientStaticContext<TContract> {
  const stack = createMongoExecutionStack({
    target: mongoRuntimeTarget,
    adapter: mongoRuntimeAdapter,
  });
  const context = createMongoExecutionContext<TContract>({ contract, stack });
  const enumsByNamespace = buildMongoEnums(contract, context.codecs);
  const unbound = enumsByNamespace[UNBOUND_NAMESPACE_ID];
  assertDefined(unbound, 'the unbound namespace always exists on a mongo builder output');
  const enums = blindCast<
    UnboundEnums<TContract>,
    'built from this contract domain; the mapped-type shape cannot be proven statically'
  >(unbound);
  const query = mongoQuery<TContract>({ contractJson: contract });
  const raw = mongoRaw<TContract>({ contract });
  return { context, contract, enums, enumsByNamespace, query, raw };
}

export default function mongoStatic<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
>(options: { readonly contractJson: unknown }): MongoStaticContext<TContract> {
  const contract = blindCast<
    TContract,
    'MongoContractSerializer validates and returns a typed contract'
  >(new MongoContractSerializer().deserializeContract(options.contractJson));
  return buildMongoStaticContext(contract);
}
