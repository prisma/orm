import mongoRuntimeAdapter from '@internal/adapter-mongo/runtime';
import type { NamespacedEnums } from '@internal/contract/enum-accessor';
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
  type MongoExecutionStack,
} from '@internal/mongo-runtime';
import mongoRuntimeTarget from '@internal/target-mongo/runtime';
import { assertDefined } from '@internal/utils/assertions';
import { blindCast } from '@internal/utils/casts';
import { validateMongoContract } from './contract-from-json';

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
  readonly stack: MongoExecutionStack;
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
  const query = mongoQuery({ context });
  const raw = mongoRaw({ context });
  return { context, contract, enums, enumsByNamespace, query, raw, stack };
}

/**
 * The query surfaces of a Mongo client without a driver: `query`, `raw` and `enums`. Use it where
 * loading `mongodb` is not wanted.
 *
 * @example
 * ```ts
 * const { enums } = mongoStatic({ contract: contractFromJson<Contract>(contractJson) });
 * ```
 */
export default function mongoStatic<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
>(options: { readonly contract: TContract }): MongoStaticContext<TContract> {
  return buildMongoStaticContext(validateMongoContract(options.contract));
}
