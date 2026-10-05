import mongoRuntimeAdapter from '@internal/adapter-mongo/runtime';
import {
  buildNamespacedEnums,
  type EnumMemberCodec,
  type NamespacedEnums,
} from '@internal/contract/enum-accessor';
import { MongoContractSerializer } from '@internal/family-mongo/ir';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { runtimeError } from '@internal/framework-components/runtime';
import type {
  AnyMongoTypeMaps,
  MongoContract,
  MongoContractWithTypeMaps,
} from '@internal/mongo-contract';
import type { MongoRawClient } from '@internal/mongo-orm';
import { mongoRaw } from '@internal/mongo-orm';
import { mongoQuery } from '@internal/mongo-query-builder';
import {
  createMongoExecutionContext,
  createMongoExecutionStack,
  type MongoCodecLookup,
  type MongoExecutionContext,
} from '@internal/mongo-runtime';
import mongoRuntimeTarget from '@internal/target-mongo/runtime';
import { assertDefined } from '@internal/utils/assertions';
import { blindCast } from '@internal/utils/casts';

type UnboundEnums<TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>> =
  NamespacedEnums<TContract>[typeof UNBOUND_NAMESPACE_ID];

function enumCodec(codecs: MongoCodecLookup, codecId: string): EnumMemberCodec {
  const codec = codecs.get(codecId);
  if (codec === undefined) {
    throw runtimeError(
      'RUNTIME.CODEC_DESCRIPTOR_MISSING',
      `No codec is registered for codecId '${codecId}', which a domain enum in the contract uses.`,
      { codecId },
    );
  }
  return codec;
}

function extractUnboundEnums<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
>(contract: TContract, codecs: MongoCodecLookup): UnboundEnums<TContract> {
  const enums = buildNamespacedEnums<TContract>(contract.domain, (codecId) =>
    enumCodec(codecs, codecId),
  )[UNBOUND_NAMESPACE_ID];
  assertDefined(enums, 'the unbound namespace always exists on a mongo builder output');
  return enums;
}

export interface MongoStaticContext<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
> {
  readonly context: MongoExecutionContext<TContract>;
  readonly contract: TContract;
  readonly enums: UnboundEnums<TContract>;
  readonly query: ReturnType<typeof mongoQuery<TContract>>;
  readonly raw: MongoRawClient<TContract>;
}

export function buildMongoStaticContext<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
>(contract: TContract): MongoStaticContext<TContract> {
  const stack = createMongoExecutionStack({
    target: mongoRuntimeTarget,
    adapter: mongoRuntimeAdapter,
  });
  const context = createMongoExecutionContext<TContract>({ contract, stack });
  const enums = extractUnboundEnums(contract, context.codecs);
  const query = mongoQuery<TContract>({ contractJson: contract });
  const raw = mongoRaw<TContract>({ contract });
  return { context, contract, enums, query, raw };
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
