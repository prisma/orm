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
}

/** A model whose rows are stored in a shared single-table-inheritance table, with what it declares there. */
export interface TableSharer<ForeignKey> {
  readonly modelName: string;
  readonly columns: ReadonlySet<string>;
  readonly foreignKeys: readonly ForeignKey[];
  readonly uniques: readonly UniqueConstraintNode[];
  readonly indexes: readonly IndexNode[];
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
      readonly kind: 'unique';
      readonly variant: string;
      readonly unique: UniqueConstraintNode;
      /** The model that maps those columns without the same relation and unique, when that is the reason. */
      readonly sharedWith: string | undefined;
    }
  | {
      readonly kind: 'index';
      readonly variant: string;
      readonly index: IndexNode;
      /** The base or the variant that already declares the same index under another name, when that is the reason. */
      readonly namedDifferentlyBy: string | undefined;
    };

export interface SharedTableMerge<ForeignKey> {
  readonly uniques: readonly UniqueConstraintNode[];
  readonly indexes: readonly IndexNode[];
  readonly foreignKeys: readonly ForeignKey[];
  readonly refusals: readonly SharedTableRefusal<ForeignKey>[];
}

/**
 * The uniques, indexes and foreign keys of a table that single-table-inheritance variants share with their base, and what of the variants' declarations is refused.
 *
 * Another model whose rows are in the table may write the same columns, so a variant's declaration is checked against every other model that maps one of its columns:
 * - A variant's foreign key is refused unless each such model declares the same foreign key, compared by its source-to-target column pairs; otherwise that model's rows would have to satisfy it. A foreign key that creates no constraint is not checked.
 * - A variant's unique is accepted only over exactly the columns of one of its own foreign keys, and only when each such model declares the same foreign key and the same unique. Its columns then hold NULL in every other row, so it constrains only the rows that relate.
 * - A variant's index without a `where` condition is accepted only when it is identical in content to the backing index one of its own foreign keys derives. The same index already on the table under the same name is kept once; under another name, whether the base or another variant declares it, it is refused.
 * - Identical declarations are kept once, in the order first declared.
 */
/** How a message names columns: `column "a"` or `columns "a", "b"`. */
export function columnsPhrase(columns: readonly string[]): string {
  const quoted = columns.map((column) => `"${column}"`).join(', ');
  return columns.length === 1 ? `column ${quoted}` : `columns ${quoted}`;
}

export function mergeSharedTable<ForeignKey>(input: {
  readonly tableName: string;
  readonly base: TableSharer<ForeignKey>;
  readonly variants: readonly TableSharer<ForeignKey>[];
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
  const uniques = [...base.uniques];
  const indexes = [...base.indexes];
  const indexDeclarers = new Map<IndexNode, string>();

  for (const [position, variant] of variants.entries()) {
    for (const foreignKey of variant.foreignKeys) {
      const view = viewOf(foreignKey);
      const identity = foreignKeyIdentity(view);
      const other = view.constraint
        ? othersMapping(variant, view.columns).find((sharer) => {
            if (declaresForeignKey(sharer, identity)) return false;
            const later = variants.indexOf(sharer) > position;
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
      const own = variant.foreignKeys.find((foreignKey) =>
        sameColumnSet(viewOf(foreignKey).columns, unique.columns),
      );
      if (own === undefined) {
        refusals.push({
          kind: 'unique',
          variant: variant.modelName,
          unique,
          sharedWith: undefined,
        });
        continue;
      }
      const identity = identityOf(own);
      const other = othersMapping(variant, unique.columns).find(
        (sharer) =>
          !declaresForeignKey(sharer, identity) ||
          !sharer.uniques.some((candidate) => sameUnique(candidate, unique)),
      );
      if (other !== undefined) {
        refusals.push({
          kind: 'unique',
          variant: variant.modelName,
          unique,
          sharedWith: other.modelName,
        });
        continue;
      }
      if (!uniques.some((existing) => sameUnique(existing, unique))) uniques.push(unique);
    }

    for (const index of variant.indexes) {
      if (index.where !== undefined) {
        if (!indexes.some((existing) => sameIndex(existing, index))) indexes.push(index);
        continue;
      }
      const { columns } = index;
      const backing =
        columns !== undefined &&
        variant.foreignKeys.some((foreignKey) => {
          const view = viewOf(foreignKey);
          return view.derivesIndex && isArrayEqual(view.columns, columns);
        }) &&
        identicalIndexes(indexNodeOf(loweredOf(index)), derivedBackingIndexNode(columns));
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

  return { uniques, indexes, foreignKeys, refusals };
}

/** A foreign key's identity: its source-to-target column pairs, in source column order, and everything else about it. Two foreign keys that list the same pairs in another order are the same foreign key. */
function foreignKeyIdentity(view: SharedForeignKeyView): string {
  const pairs = view.columns
    .map((column, position) => [column, view.targetColumns[position]] as const)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return canonicalStringify({ pairs, rest: view.rest });
}

function sameColumnSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((column) => right.includes(column));
}

function sameUnique(left: UniqueConstraintNode, right: UniqueConstraintNode): boolean {
  return isArrayEqual(left.columns, right.columns) && left.name === right.name;
}
