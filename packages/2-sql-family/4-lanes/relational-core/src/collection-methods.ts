import type { ContractField, ContractRelation } from '@internal/contract/types';
import type { StorageTable } from '@internal/sql-contract/types';
import type { IndexReference } from './index-reference';

/**
 * One model, as a contribution's type half reads it: the contract's target, the model's name, its fields with their codec ids and type parameters, its relations, and its storage table with columns and indexes.
 */
export interface CollectionMethodModelType {
  readonly target: string;
  readonly name: string;
  readonly fields: object;
  readonly relations: object;
  readonly table: { readonly columns: object; readonly indexes: readonly unknown[] };
}

/**
 * One contributed method, as the type half declares it: its parameter list, and whether it adds a filter and an order. A method that only sometimes filters declares `filters: false`.
 */
export interface ContributedMethodSignature {
  readonly parameters: readonly unknown[];
  readonly filters: boolean;
  readonly orders: boolean;
}

/**
 * The type half of a contribution. The ORM client fills `model` with one model's `CollectionMethodModelType` and reads `methods` back: the model's methods by name. An implementation computes `methods` from `this['model']`.
 */
export interface CollectionMethodContributionType {
  readonly model: CollectionMethodModelType;
  readonly methods: { readonly [name: string]: ContributedMethodSignature };
}

/**
 * The type halves of the contributions, keyed by the id of their run-time half. A package adds its type half by declaration merging on this module, published as `@prisma/orm-family-sql/relational-core/collection-methods`, in a module that its entry points type-export from.
 */
export interface CollectionMethodRegistry {
  /** Keeps the interface from being empty, which would make it a type alias that cannot be merged. */
  readonly __collectionMethodRegistry?: never;
}

/** The id of a contribution whose type half is registered in `CollectionMethodRegistry`. */
export type CollectionMethodContributionId = Exclude<
  keyof CollectionMethodRegistry,
  '__collectionMethodRegistry'
>;

/** The second argument of an ORM `where` or `orderBy` callback, as a contributed method reads it. */
export interface CollectionMethodTools {
  readonly fns: Readonly<Record<string, (...args: never[]) => unknown>>;
  readonly indexes: Readonly<Record<string, IndexReference>>;
}

/**
 * The collection a contributed method refines, seen only through `where` and `orderBy`. Their callbacks receive the ORM's model accessor, whose fields have their query operations, and `{ fns, indexes }`.
 */
export interface CollectionMethodReceiver {
  where(
    condition: (model: unknown, tools: CollectionMethodTools) => unknown,
  ): CollectionMethodReceiver;
  orderBy(
    order: (model: unknown, tools: CollectionMethodTools) => unknown,
  ): CollectionMethodReceiver;
}

/** A contributed method's body: refines `collection` with the method's arguments. */
export type CollectionMethodBody = (
  collection: CollectionMethodReceiver,
  ...args: never[]
) => CollectionMethodReceiver;

/** One model, as a contribution's run-time half reads it. */
export interface CollectionMethodModel {
  readonly target: string;
  readonly name: string;
  readonly fields: Readonly<Record<string, ContractField>>;
  readonly relations: Readonly<Record<string, ContractRelation>>;
  readonly table: StorageTable;
}

/**
 * The run-time half of a contribution. `methodsFor` returns one model's methods by name; the ORM client calls it once for each model of the contract. `id` is the key its type half registers under in `CollectionMethodRegistry`.
 */
export interface CollectionMethodContribution {
  readonly id: string;
  methodsFor(model: CollectionMethodModel): Readonly<Record<string, CollectionMethodBody>>;
}
