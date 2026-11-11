import type { ContractModel } from '@internal/contract/types';
import type { MongoModelStorage } from '@internal/mongo-contract';
import type { MongoFilterExpr } from '@internal/mongo-query-ast/execution';
import type { MongoPreparedParamRef } from '@internal/mongo-value';

export interface MongoIncludeExpr {
  readonly relationName: string;
  readonly targetModelName: string;
  readonly targetModel: ContractModel<MongoModelStorage>;
  readonly from: string;
  readonly localField: string;
  readonly foreignField: string;
  readonly cardinality: '1:1' | 'N:1' | '1:N' | 'N:M';
}

export interface MongoCollectionState {
  readonly filters: readonly MongoFilterExpr[];
  readonly includes: readonly MongoIncludeExpr[];
  readonly orderBy: Readonly<Record<string, 1 | -1>> | undefined;
  readonly selectedFields: readonly string[] | undefined;
  readonly limit: number | MongoPreparedParamRef | undefined;
  readonly offset: number | MongoPreparedParamRef | undefined;
}

export function emptyCollectionState(): MongoCollectionState {
  return {
    filters: [],
    includes: [],
    orderBy: undefined,
    selectedFields: undefined,
    limit: undefined,
    offset: undefined,
  };
}
