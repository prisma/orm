import { SqlIndexIR } from '@internal/sql-schema-ir/types';
import type { IndexInput } from './ir/sql-index';

/** The schema node the planner builds for an index the contract states, which is what it compares. */
export function indexNodeOf(index: IndexInput): SqlIndexIR {
  return new SqlIndexIR({
    ...index,
    annotations: undefined,
    dependsOn: undefined,
    partial: index.where !== undefined,
  });
}

/** Whether the planner sees two indexes as the same index apart from their names. */
export function identicalIndexes(a: SqlIndexIR, b: SqlIndexIR): boolean {
  return a.contentEquals(b, { columnPresence: 'matching', bodies: 'verbatim' });
}

/** The index the contract build derives to back a foreign key on `columns`, as the planner sees it. */
export function derivedBackingIndexNode(columns: readonly string[]): SqlIndexIR {
  return new SqlIndexIR({
    naming: { kind: 'exact', name: 'derived backing index' },
    columns,
    where: undefined,
    unique: false,
    type: undefined,
    options: undefined,
    annotations: undefined,
    dependsOn: undefined,
    partial: false,
  });
}

/** What already serves a plain index's lookups: the primary key, a unique constraint or a unique index on exactly its columns. */
export type ServingKey<TIndex, TUnique, TPrimaryKey> =
  | { readonly kind: 'primaryKey'; readonly primaryKey: TPrimaryKey }
  | { readonly kind: 'uniqueConstraint'; readonly unique: TUnique }
  | { readonly kind: 'index'; readonly index: TIndex };

type Keyed = { readonly columns: readonly string[] };

export interface KeyedTable<TIndex, TUnique extends Keyed, TPrimaryKey extends Keyed> {
  readonly indexes: readonly TIndex[];
  readonly nodeOf: (index: TIndex) => SqlIndexIR;
  readonly uniques: readonly TUnique[];
  readonly primaryKey: TPrimaryKey | undefined;
}

export function sameColumns(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && startsWithColumns(a, b);
}

/** Whether `columns` begins with `leading`, in order: an index or key on such columns serves lookups on `leading`. */
export function startsWithColumns(columns: readonly string[], leading: readonly string[]): boolean {
  return (
    leading.length <= columns.length &&
    leading.every((column, position) => column === columns[position])
  );
}

/**
 * The key that serves every lookup of `index`, when `index` is a plain non-unique index: one the planner sees as identical to an index derived on its columns. A unique index serves only when it has no predicate.
 */
export function servingKey<TIndex, TUnique extends Keyed, TPrimaryKey extends Keyed>(
  index: SqlIndexIR,
  table: KeyedTable<TIndex, TUnique, TPrimaryKey>,
): ServingKey<TIndex, TUnique, TPrimaryKey> | undefined {
  const { columns } = index;
  if (columns === undefined || !identicalIndexes(index, derivedBackingIndexNode(columns))) {
    return undefined;
  }
  if (table.primaryKey !== undefined && sameColumns(table.primaryKey.columns, columns)) {
    return { kind: 'primaryKey', primaryKey: table.primaryKey };
  }
  const unique = table.uniques.find((constraint) => sameColumns(constraint.columns, columns));
  if (unique !== undefined) return { kind: 'uniqueConstraint', unique };
  const uniqueIndex = table.indexes.find((candidate) => {
    const node = table.nodeOf(candidate);
    return (
      node.unique &&
      node.where === undefined &&
      node.columns !== undefined &&
      sameColumns(node.columns, columns)
    );
  });
  return uniqueIndex === undefined ? undefined : { kind: 'index', index: uniqueIndex };
}

/**
 * Whether the contract build would drop the backing index it derives for a foreign key on `columns`, because the table already has an identical index or a key serving its lookups. `contract infer` asks this of a live table to decide whether a relation needs `index: false`.
 */
export function derivedBackingIndexIsRedundant<
  TIndex,
  TUnique extends Keyed,
  TPrimaryKey extends Keyed,
>(columns: readonly string[], table: KeyedTable<TIndex, TUnique, TPrimaryKey>): boolean {
  const derived = derivedBackingIndexNode(columns);
  return (
    table.indexes.some((index) => identicalIndexes(table.nodeOf(index), derived)) ||
    servingKey(derived, table) !== undefined
  );
}
