import {
  derivedBackingIndexNode,
  identicalIndexes,
  indexNodeOf,
} from '@internal/sql-contract/foreign-key-materialization';
import { lowerAuthoredIndex } from '@internal/sql-contract/index-naming';
import type { IndexInput } from '@internal/sql-contract/types';
import { isArrayEqual } from '@internal/utils/array-equal';
import { canonicalStringify } from '@internal/utils/canonical-stringify';
import type { IndexNode, UniqueConstraintNode } from './contract-definition';
import { authoredIndexInput } from './lower-table';

/** What the shared-table rules read from a foreign key, whatever form the source gives it in. */
export interface SharedForeignKeyView {
  readonly columns: readonly string[];
  readonly targetColumns: readonly string[];
  /** Everything else that tells two foreign keys apart: target table, name, referential actions, constraint and index intent. */
  readonly rest: unknown;
  readonly constraint: boolean;
  readonly derivesIndex: boolean;
  /** The name of the declared index the foreign key names as its backing index, if it names one. */
  readonly namedIndex: string | undefined;
}

/** A model whose rows are stored in a shared single-table-inheritance table, with what it declares there. */
export interface TableSharer<ForeignKey> {
  readonly modelName: string;
  readonly columns: ReadonlySet<string>;
  /** Columns this model gives a stored default, which a row of any model of the table then gets when it leaves the column out. */
  readonly defaultedColumns: ReadonlySet<string>;
  readonly foreignKeys: readonly ForeignKey[];
  readonly indexes: readonly IndexNode[];
}

/** A variant that shares its base's table, with the uniques it declares, which are all refused. */
export interface VariantTableSharer<ForeignKey> extends TableSharer<ForeignKey> {
  readonly uniques: readonly UniqueConstraintNode[];
}

export type SharedTableRefusal<ForeignKey> =
  | {
      readonly kind: 'foreignKey';
      readonly variant: string;
      readonly foreignKey: ForeignKey;
      readonly columns: readonly string[];
      readonly other: string;
      readonly otherIsBase: boolean;
      /** The other model declares a different foreign key on those columns, rather than none. */
      readonly otherDeclaresOne: boolean;
    }
  | {
      readonly kind: 'defaultedForeignKey';
      readonly variant: string;
      readonly foreignKey: ForeignKey;
      /** The foreign key's columns that have a stored default. */
      readonly columns: readonly string[];
    }
  | {
      readonly kind: 'unique';
      readonly variant: string;
      readonly unique: UniqueConstraintNode;
    }
  | {
      readonly kind: 'index';
      readonly variant: string;
      readonly index: IndexNode;
      /** The base or the variant that already declares the same index under another name, when that is the reason. */
      readonly namedDifferentlyBy: string | undefined;
    }
  | { readonly kind: '%future added value'; readonly variant: string };

export interface SharedTableMerge<ForeignKey> {
  readonly indexes: readonly IndexNode[];
  readonly foreignKeys: readonly ForeignKey[];
  readonly refusals: readonly SharedTableRefusal<ForeignKey>[];
}

/** How a message names columns: `column "a"` or `columns "a", "b"`. */
export function columnsPhrase(columns: readonly string[]): string {
  const quoted = columns.map((column) => `"${column}"`).join(', ');
  return columns.length === 1 ? `column ${quoted}` : `columns ${quoted}`;
}

/**
 * The indexes and foreign keys of a table that single-table-inheritance variants share with their base, and what of the variants' declarations is refused.
 *
 * Another model whose rows are in the table may write the same columns, so a variant's declaration is checked against every other model that maps one of its columns:
 * - A variant's foreign key is refused unless each such model declares the same foreign key, compared by its source-to-target column pairs; otherwise that model's rows would have to satisfy it. It is refused too when one of its columns has a stored default, which every row of the table would get. A foreign key that creates no constraint is not checked.
 * - A variant's unique is always refused: on the shared table it would also constrain the other rows. A one-to-one relation from a variant, which needs one, is therefore not supported yet.
 * - A variant's index without a `where` condition is accepted only when it backs one of its own foreign keys: it is identical in content to the backing index the foreign key derives, or it is the plain index the foreign key names as its backing index and starts with the foreign key's columns.
 * - A backing index over a column with a stored default is not accepted, since every row of the table gets the default. The same index already on the table under the same name is kept once; under another name, whether the base or another variant declares it, it is refused.
 * - Identical declarations are kept once, in the order first declared.
 */
export function mergeSharedTable<ForeignKey>(input: {
  readonly tableName: string;
  readonly base: TableSharer<ForeignKey>;
  readonly variants: readonly VariantTableSharer<ForeignKey>[];
  readonly viewOf: (foreignKey: ForeignKey) => SharedForeignKeyView;
}): SharedTableMerge<ForeignKey> {
  const { tableName, base, variants, viewOf } = input;
  const sharers = [base, ...variants];
  const identityOf = (foreignKey: ForeignKey) => foreignKeyIdentity(viewOf(foreignKey));
  const mapsColumn = (sharer: TableSharer<ForeignKey>, column: string) =>
    sharer.columns.has(column) ||
    sharer.foreignKeys.some((foreignKey) => viewOf(foreignKey).columns.includes(column));
  const othersMapping = (variant: TableSharer<ForeignKey>, columns: readonly string[]) =>
    sharers.filter(
      (sharer) => sharer !== variant && columns.some((column) => mapsColumn(sharer, column)),
    );
  const declaresForeignKey = (sharer: TableSharer<ForeignKey>, identity: string) =>
    sharer.foreignKeys.some((foreignKey) => identityOf(foreignKey) === identity);
  const declaresConstraintOn = (sharer: TableSharer<ForeignKey>, columns: readonly string[]) =>
    sharer.foreignKeys.some((foreignKey) => {
      const view = viewOf(foreignKey);
      return view.constraint && view.columns.some((column) => columns.includes(column));
    });
  const lowered = new Map<IndexNode, IndexInput>();
  const loweredOf = (index: IndexNode) => {
    const known = lowered.get(index);
    if (known !== undefined) return known;
    const input = lowerAuthoredIndex(tableName, authoredIndexInput(index));
    lowered.set(index, input);
    return input;
  };
  const sameContent = (a: IndexNode, b: IndexNode) =>
    identicalIndexes(indexNodeOf(loweredOf(a)), indexNodeOf(loweredOf(b)));
  const sameIndex = (a: IndexNode, b: IndexNode) =>
    sameContent(a, b) &&
    canonicalStringify(loweredOf(a).naming) === canonicalStringify(loweredOf(b).naming);

  const refusals: SharedTableRefusal<ForeignKey>[] = [];
  const foreignKeys = [...base.foreignKeys];
  const indexes = [...base.indexes];
  const indexDeclarers = new Map<IndexNode, string>();

  for (const [position, variant] of variants.entries()) {
    const defaulted = (columns: readonly string[]) =>
      columns.filter((column) => variant.defaultedColumns.has(column));
    for (const foreignKey of variant.foreignKeys) {
      const view = viewOf(foreignKey);
      const identity = foreignKeyIdentity(view);
      if (view.constraint && defaulted(view.columns).length > 0) {
        refusals.push({
          kind: 'defaultedForeignKey',
          variant: variant.modelName,
          foreignKey,
          columns: defaulted(view.columns),
        });
        continue;
      }
      const other = view.constraint
        ? othersMapping(variant, view.columns).find((sharer) => {
            if (declaresForeignKey(sharer, identity)) return false;
            const later = variants.findIndex((candidate) => candidate === sharer) > position;
            return !(later && declaresConstraintOn(sharer, view.columns));
          })
        : undefined;
      if (other !== undefined) {
        refusals.push({
          kind: 'foreignKey',
          variant: variant.modelName,
          foreignKey,
          columns: view.columns.filter((column) => mapsColumn(other, column)),
          other: other.modelName,
          otherIsBase: other === base,
          otherDeclaresOne: declaresConstraintOn(other, view.columns),
        });
        continue;
      }
      if (!foreignKeys.some((existing) => identityOf(existing) === identity)) {
        foreignKeys.push(foreignKey);
      }
    }

    for (const unique of variant.uniques) {
      refusals.push({ kind: 'unique', variant: variant.modelName, unique });
    }

    for (const index of variant.indexes) {
      if (index.where !== undefined) {
        if (!indexes.some((existing) => sameIndex(existing, index))) indexes.push(index);
        continue;
      }
      const { columns } = index;
      const backing =
        columns !== undefined &&
        defaulted(columns).length === 0 &&
        variant.foreignKeys.some((foreignKey) => {
          const view = viewOf(foreignKey);
          if (view.namedIndex !== undefined) {
            return (
              (index.name === view.namedIndex || index.map === view.namedIndex) &&
              index.unique !== true &&
              isArrayEqual(columns.slice(0, view.columns.length), view.columns)
            );
          }
          return (
            view.derivesIndex &&
            isArrayEqual(view.columns, columns) &&
            identicalIndexes(indexNodeOf(loweredOf(index)), derivedBackingIndexNode(columns))
          );
        });
      if (!backing) {
        refusals.push({
          kind: 'index',
          variant: variant.modelName,
          index,
          namedDifferentlyBy: undefined,
        });
        continue;
      }
      const earlier = indexes.find((existing) => sameContent(existing, index));
      if (earlier === undefined) {
        indexes.push(index);
        indexDeclarers.set(index, variant.modelName);
      } else if (!sameIndex(earlier, index)) {
        refusals.push({
          kind: 'index',
          variant: variant.modelName,
          index,
          namedDifferentlyBy: indexDeclarers.get(earlier) ?? base.modelName,
        });
      }
    }
  }

  return { indexes, foreignKeys, refusals };
}

/** A foreign key's identity: its source-to-target column pairs, in source column order, and everything else about it. Two foreign keys that list the same pairs in another order are the same foreign key. */
function foreignKeyIdentity(view: SharedForeignKeyView): string {
  const pairs = view.columns
    .map((column, position) => [column, view.targetColumns[position]] as const)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return canonicalStringify({ pairs, rest: view.rest });
}
