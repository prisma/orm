import type { StorageTable } from '@internal/sql-contract/types';
import { structuredError } from '@internal/utils/structured-error';
import type { Expression, ScopeField } from './expression';

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

type ColumnField<Column> = Column extends {
  readonly codecId: infer CodecId;
  readonly nullable: infer Nullable;
}
  ? Column extends { many: true }
    ? { codecId: CodecId; nullable: Nullable; many: true }
    : { codecId: CodecId; nullable: Nullable }
  : never;

type IndexColumnExpressions<Columns, I> = I extends {
  readonly columns: infer IndexColumns extends readonly string[];
}
  ? {
      readonly [Column in IndexColumns[number]]: Column extends keyof Columns
        ? ColumnField<Columns[Column]> extends infer Field extends ScopeField
          ? Expression<Field>
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
 * A storage table's indexes, keyed by the name the contract source gave each: the `name:` prefix, or the `map:` name. An unnamed index, such as a derived foreign-key backing index, appears under its default prefix. A name that more than one index shares is left out, as reading it is refused at runtime.
 */
export type TableIndexReferences<Table> = Table extends {
  readonly indexes: readonly (infer I)[];
  readonly columns: infer Columns;
}
  ? {
      readonly [Key in AuthoredIndexName<I> as true extends IsUnion<IndexesNamed<I, Key>>
        ? never
        : Key]: IndexReference<
        IndexColumnExpressions<Columns, IndexesNamed<I, Key>>,
        IndexTypeOf<IndexesNamed<I, Key>>,
        IndexOptionsOf<IndexesNamed<I, Key>>
      >;
    }
  : never;

export interface IndexReferencesInput {
  readonly namespaceId: string;
  readonly tableName: string;
  readonly table: StorageTable;
  /** The column of the table as this query reads it: under the table's alias, with its codec. */
  readonly column: (columnName: string) => Expression<ScopeField>;
}

/**
 * The index references of a table, keyed by authored name. A name more than one index shares throws `ORM.ARGUMENT_INVALID` when it is read.
 */
export function createIndexReferences(
  input: IndexReferencesInput,
): Readonly<Record<string, IndexReference>> {
  const byName = new Map<string, IndexReference[]>();
  for (const index of input.table.indexes) {
    const authoredName = index.prefix ?? index.name;
    const columns = Object.fromEntries(
      (index.columns ?? []).map((column) => [column, input.column(column)]),
    );
    const reference = Object.freeze({
      columns: Object.freeze(columns),
      type: index.type,
      options: index.options,
    });
    byName.set(authoredName, [...(byName.get(authoredName) ?? []), reference]);
  }
  const references = {};
  for (const [authoredName, [reference, ...others]] of byName) {
    Object.defineProperty(references, authoredName, {
      enumerable: true,
      get: () => {
        if (others.length > 0) throw ambiguousIndexName(input, authoredName);
        return reference;
      },
    });
  }
  return Object.freeze(references);
}

function ambiguousIndexName(input: IndexReferencesInput, authoredName: string) {
  return structuredError(
    'ORM.ARGUMENT_INVALID',
    `Table "${input.tableName}" has more than one index named "${authoredName}".`,
    {
      why: 'An index is read by the name its contract source gave it, and these indexes share that name.',
      fix: `Give each of these indexes of table "${input.tableName}" its own name in the contract source.`,
      meta: { namespaceId: input.namespaceId, tableName: input.tableName, index: authoredName },
    },
  );
}
