import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { CollectionTypeState, DefaultModelRow } from './types';

export declare const RowType: unique symbol;

export declare const TypeState: unique symbol;

/** Something that yields values of type `Row`: a collection, whose row includes the relations and values `include` adds, or an include scalar or combine, which yields one value per parent row. */
export interface HasRow<Row = unknown> {
  readonly [RowType]: Row;
}

/** A collection whose type state is `State`. */
export interface HasTypeState<State = CollectionTypeState> {
  readonly [TypeState]: State;
}

/** The fact that a filter has been applied: the type-state flag `hasWhere` is `true`. Write `Filtered<C>` for a filtered collection; error messages print `HasWhere`. */
export interface HasWhere extends HasTypeState<{ readonly hasWhere: true }> {}

/** The fact that an order has been applied: the type-state flag `hasOrderBy` is `true`. Write `Ordered<C>` for an ordered collection; error messages print `HasOrderBy`. */
export interface HasOrderBy extends HasTypeState<{ readonly hasOrderBy: true }> {}

/** The fact that no variant has been selected: the type-state field `variantName` is `undefined`. `variant()` needs it; error messages print `HasNoVariant`. */
export interface HasNoVariant extends HasTypeState<{ readonly variantName: undefined }> {}

/** A collection with a filter applied: `C & HasWhere`. */
export type Filtered<C> = C & HasWhere;

/** A collection with an order applied: `C & HasOrderBy`. */
export type Ordered<C> = C & HasOrderBy;

/** A collection whose rows also have the fields of `Added`, such as an included relation. */
export type Including<C extends HasRow, Added> = C & HasRow<CollectionRowOf<C> & Added>;

/** A scope: a function from one collection to another. `collection.with(scope)` runs it. */
export type Scope<In, Out> = (collection: In) => Out;

/** What a scope made by `collection.scope` accepts: a collection of the model, in the same namespace when the scope's collection names one, whose rows have every field of the model and that is not narrowed to a variant. */
export type ModelScopeReceiver<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string = never,
> = HasRow<DefaultModelRow<TContract, ModelName, NsId>> &
  HasTypeState<
    [NsId] extends [never]
      ? { readonly variantName: undefined }
      : { readonly variantName: undefined; readonly nsId: NsId }
  > & { readonly modelName: ModelName };

/** The type state of a collection. */
export type CollectionTypeStateOf<C extends HasTypeState> = C[typeof TypeState];

/** The rows a collection produces, as one object type. Declarations print it by this name, so it never names `RowType`. */
export type CollectionRowOf<C extends HasRow> = C[typeof RowType] extends infer Row extends
  C[typeof RowType]
  ? { [K in keyof Row]: Row[K] }
  : never;
