import type { MongoModelDefinition } from '@internal/mongo-contract';
import type { MongoFilterExpr } from '@internal/mongo-query-ast/execution';

export interface MongoIncludeExpr {
  readonly relationName: string;
  readonly targetModel: MongoModelDefinition;
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
  readonly limit: number | undefined;
  readonly offset: number | undefined;
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
