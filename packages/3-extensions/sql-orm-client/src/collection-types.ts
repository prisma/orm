import type { CollectionTypeState } from './types';

export declare const RowType: unique symbol;

export declare const StateType: unique symbol;

/** Something that produces rows of type `Row`: a collection, an include scalar or an include combine. */
export interface HasRow<Row = unknown> {
  readonly [RowType]: Row;
}

/** A collection whose type state is `State`. */
export interface HasState<State = CollectionTypeState> {
  readonly [StateType]: State;
}

/** The fact that a filter has been applied. Write `Filtered<C>` for a filtered collection. */
export interface HasWhere extends HasState<{ readonly hasWhere: true }> {}

/** The fact that an order has been applied. Write `Ordered<C>` for an ordered collection. */
export interface HasOrderBy extends HasState<{ readonly hasOrderBy: true }> {}

/** A collection with a filter applied: `C & HasWhere`. */
export type Filtered<C> = C & HasWhere;

/** A collection with an order applied: `C & HasOrderBy`. */
export type Ordered<C> = C & HasOrderBy;

/** A collection whose rows also have the fields of `Added`, such as an included relation. */
export type Including<C extends HasRow, Added> = C & HasRow<CollectionRowOf<C> & Added>;

/** A function from one collection to another; `collection.pipe(step)` applies it. */
export type Step<In, Out> = (collection: In) => Out;

/** The type state of a collection. */
export type CollectionStateOf<C extends HasState> = C[typeof StateType];

/** The rows a collection produces, as one object type. Declarations print it by this name, so it never names `RowType`. */
export type CollectionRowOf<C extends HasRow> = C[typeof RowType] extends infer Row extends
  C[typeof RowType]
  ? { [K in keyof Row]: Row[K] }
  : never;
