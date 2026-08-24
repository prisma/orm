import type { Contract } from '@internal/contract/types';
import type { ExtractAggregateTypes, SqlStorage } from '@internal/sql-contract/types';
import type { AnyExpression } from '@internal/sql-relational-core/ast';
import type { Collection } from './collection';
import type {
  CollectionContext,
  CollectionTypeState,
  DefaultCollectionTypeState,
  DefaultModelRow,
  IncludeCombine,
  IncludeCombineBranch,
  IncludeRelationValue,
  IncludeScalar,
  ModelAccessor,
  RelationCardinality,
  ShorthandWhereFilter,
} from './types';

export interface CollectionInit<TContract extends Contract<SqlStorage>> {
  readonly tableName?: string | undefined;
  readonly namespaceId: string;
  readonly state?: import('./types').CollectionState | undefined;
  readonly registry?: ReadonlyMap<string, CollectionConstructor<TContract>> | undefined;
  readonly includeRefinementMode?: boolean | undefined;
}

export type CollectionConstructor<TContract extends Contract<SqlStorage>> = new (
  ctx: CollectionContext<TContract>,
  modelName: string,
  options?: CollectionInit<TContract>,
) => Collection<TContract, string, unknown, CollectionTypeState>;

export type WithWhereState<State extends CollectionTypeState> = Omit<State, 'hasWhere'> & {
  readonly hasWhere: true;
};

export type WithOrderByState<State extends CollectionTypeState> = Omit<State, 'hasOrderBy'> & {
  readonly hasOrderBy: true;
};

export type WithVariantState<State extends CollectionTypeState, V extends string> = Omit<
  State,
  'variantName'
> & {
  readonly variantName: V;
};

export type IncludedRelationsForRow<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  Row,
> = Omit<Row, keyof DefaultModelRow<TContract, ModelName>>;

export type IncludeRefinementTerminals =
  | 'all'
  | 'first'
  | 'aggregate'
  | 'groupBy'
  | 'create'
  | 'createAll'
  | 'createAndCount'
  | 'update'
  | 'updateAll'
  | 'updateAndCount'
  | 'delete'
  | 'deleteAll'
  | 'deleteAndCount'
  | 'upsert'
  | 'upsertAll';

/**
 * The members a to-one refinement collection strips: the scalar reducers the
 * contract's emitted aggregate map declares, plus `combine`. Both reduce a
 * to-many relation; a to-one relation has nothing to reduce. A contract whose
 * map is unknown carries no typed reducers, so only `combine` is stripped —
 * subtracting the non-literal key set would strip the whole surface.
 */
export type IncludeRefinementScalarMethods<TContract extends Contract<SqlStorage>> =
  | (string extends keyof ExtractAggregateTypes<TContract> & string
      ? never
      : keyof ExtractAggregateTypes<TContract> & string)
  | 'combine';

export type IncludeRefinementCollection<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  Row,
  State extends CollectionTypeState,
  IsToMany extends boolean,
> = Omit<
  Collection<TContract, ModelName, Row, State>,
  | IncludeRefinementTerminals
  | (IsToMany extends true ? never : IncludeRefinementScalarMethods<TContract>)
>;

export type IsToManyRelation<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  RelName extends string,
  NsId extends string = never,
> = RelationCardinality<TContract, ModelName, RelName, NsId> extends '1:N' | 'N:M' ? true : false;

export type IncludeRefinementResult<
  TContract extends Contract<SqlStorage>,
  RelatedName extends string,
  IsToMany extends boolean,
> =
  | IncludeRefinementCollection<TContract, RelatedName, unknown, CollectionTypeState, IsToMany>
  | (IsToMany extends true
      ? IncludeScalar<unknown> | IncludeCombine<Record<string, unknown>>
      : never);

export declare const RowType: unique symbol;

export interface RowSelection<T> {
  [RowType]: T;
}

export type StripRowType<T> = Omit<T, typeof RowType>;

export type IncludeRefinementValue<
  TContract extends Contract<SqlStorage>,
  ParentModelName extends string,
  RelName extends string,
  DefaultIncludedRow,
  RefinedResult,
  NsId extends string = never,
> =
  RefinedResult extends RowSelection<infer V>
    ? // IncludeScalar / IncludeCombine carry a final value that must not be
      // cardinality-wrapped; Collection carries a raw row that still needs it.
      RefinedResult extends { readonly kind: 'includeScalar' | 'includeCombine' }
      ? V
      : IncludeRelationValue<TContract, ParentModelName, RelName, V, NsId>
    : IncludeRelationValue<TContract, ParentModelName, RelName, DefaultIncludedRow, NsId>;

export type WhereInput<TContract extends Contract<SqlStorage>, ModelName extends string> =
  | ((model: ModelAccessor<TContract, ModelName>) => AnyExpression)
  | ShorthandWhereFilter<TContract, ModelName>;

export interface IncludeRefinementEvaluation {
  readonly nestedState: import('./types').CollectionState;
  readonly scalarSelector: IncludeScalar<unknown> | undefined;
  readonly combineBranches: Readonly<Record<string, IncludeCombineBranch>> | undefined;
}

export type IncludeRefinementHandler<
  TContract extends Contract<SqlStorage>,
  RelatedName extends string,
  IsToMany extends boolean,
> = (
  collection: IncludeRefinementCollection<
    TContract,
    RelatedName,
    DefaultModelRow<TContract, RelatedName>,
    DefaultCollectionTypeState,
    IsToMany
  >,
) => IncludeRefinementResult<TContract, RelatedName, IsToMany>;
