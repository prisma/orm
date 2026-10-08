import type { Expression } from '../expression';
import type { ScopeField, StorageTableToScopeTable } from '../scope';
import type { NamespaceTable, TableProxyContract } from './db';

/**
 * An index of a table as a query reads it: its columns, bound to the table's alias, its type and its options. A query operation that searches what an index covers, such as Postgres's `fullTextMatches`, takes it in place of the columns and settings the index was built with.
 */
export interface IndexReference<
  Columns extends Readonly<Record<string, Expression<ScopeField>>> = Readonly<
    Record<string, Expression<ScopeField>>
  >,
  Type extends string | undefined = string | undefined,
  Options extends Readonly<Record<string, unknown>> | undefined =
    | Readonly<Record<string, unknown>>
    | undefined,
> {
  /** The index's columns by name, each the column of the aliased table; empty for an expression index. */
  readonly columns: Columns;
  readonly type: Type;
  readonly options: Options;
}

/** The name the contract source gave an index: the prefix of a wire name, or an exact (`map:`) name. */
type AuthoredIndexName<I> = I extends { readonly prefix: infer Prefix extends string }
  ? Prefix
  : I extends { readonly name: infer Name extends string }
    ? Name
    : never;

type IndexColumnExpressions<Fields, I> = I extends {
  readonly columns: infer Columns extends readonly string[];
}
  ? {
      readonly [Column in Columns[number]]: Column extends keyof Fields
        ? Fields[Column] extends ScopeField
          ? Expression<Fields[Column]>
          : never
        : never;
    }
  : Record<never, never>;

type IndexTypeOf<I> = I extends { readonly type: infer Type extends string } ? Type : undefined;

type IndexOptionsOf<I> = I extends {
  readonly options: infer Options extends Record<string, unknown>;
}
  ? Options
  : undefined;

/** The indexes of `I` whose authored name is `Key`. */
type IndexesNamed<I, Key> = I extends unknown
  ? AuthoredIndexName<I> extends Key
    ? I
    : never
  : never;

type IsUnion<T, Whole = T> = T extends unknown ? ([Whole] extends [T] ? false : true) : never;

/**
 * A table's indexes, keyed by the name the contract source gave each: the `name:` prefix, or the `map:` name. An unnamed index, such as a derived foreign-key backing index, appears under its default prefix. A name that more than one index shares is left out, as reading it is refused at runtime.
 */
export type IndexReferences<
  C extends TableProxyContract,
  NsId extends string,
  Name extends string,
  Table = NamespaceTable<C, NsId, Name>,
  Fields = StorageTableToScopeTable<NamespaceTable<C, NsId, Name>>,
> = Table extends { readonly indexes: readonly (infer I)[] }
  ? {
      readonly [Key in AuthoredIndexName<I> as true extends IsUnion<IndexesNamed<I, Key>>
        ? never
        : Key]: IndexReference<
        IndexColumnExpressions<Fields, IndexesNamed<I, Key>>,
        IndexTypeOf<IndexesNamed<I, Key>>,
        IndexOptionsOf<IndexesNamed<I, Key>>
      >;
    }
  : never;
