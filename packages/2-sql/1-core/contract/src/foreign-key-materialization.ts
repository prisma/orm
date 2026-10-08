import { defaultIndexName, truncateToWireNamePrefixBytes } from '@internal/sql-schema-ir/naming';
import { lowerAuthoredIndex } from './index-naming';
import type { ForeignKeyInput, ReferentialAction } from './ir/foreign-key';
import type { ForeignKeyReferenceInput } from './ir/foreign-key-reference';
import type { PrimaryKeyInput } from './ir/primary-key';
import type { IndexInput } from './ir/sql-index';
import type { UniqueConstraintInput } from './ir/unique-constraint';

export type BackingIndexCandidates = {
  readonly indexes: readonly { readonly columns?: readonly string[] }[];
  readonly uniques: readonly { readonly columns: readonly string[] }[];
  readonly primaryKey?: { readonly columns: readonly string[] } | undefined;
};

/**
 * The column-list keys (`"colA,colB"`, order preserved) a table's own
 * indexes, unique constraints, and primary key already back. A foreign key
 * whose source columns join to one of these keys needs no separately
 * derived backing index.
 *
 * Shared by {@link isBackedByColumnKeys}'s callers: `materializeForeignKeysAndIndexes`
 * (deriving the discrete backing-index entities persisted at `contract emit`)
 * and the postgres PSL inferrer (deciding whether an introspected relation
 * needs an explicit `index: false`).
 */
export function backingIndexColumnKeys(table: BackingIndexCandidates): readonly string[] {
  return [
    ...table.indexes.flatMap((index) =>
      index.columns !== undefined ? [index.columns.join(',')] : [],
    ),
    ...table.uniques.map((unique) => unique.columns.join(',')),
    ...(table.primaryKey ? [table.primaryKey.columns.join(',')] : []),
  ];
}

/**
 * Whether `columns`, in order, matches one of `backingKeys` (see
 * {@link backingIndexColumnKeys}). Order-sensitive: `(a, b)` does not
 * satisfy a backing index declared as `(b, a)`.
 */
export function isBackedByColumnKeys(
  columns: readonly string[],
  backingKeys: readonly string[],
): boolean {
  return backingKeys.includes(columns.join(','));
}

/**
 * A foreign key as authored, before FK1 materialization: the referential
 * coordinates plus the `constraint`/`index` intent booleans that drive
 * whether — and how — it survives into the persisted contract.
 */
export interface ForeignKeyAuthoringInput {
  readonly source: ForeignKeyReferenceInput;
  readonly target: ForeignKeyReferenceInput;
  readonly name?: string;
  readonly onDelete?: ReferentialAction;
  readonly onUpdate?: ReferentialAction;
  readonly constraint: boolean;
  readonly index: boolean;
}

export interface MaterializedTableConstraints {
  readonly foreignKeys: readonly ForeignKeyInput[];
  readonly indexes: readonly IndexInput[];
}

/**
 * Lowers a table's authored foreign keys into the discrete entities
 * `contract.json` persists: a `constraint: false` FK contributes no
 * `foreignKeys[]` entry, and an `index: true` FK whose columns aren't already
 * backed by a declared index/unique/primary-key contributes a wire-named
 * `indexes[]` entry (byte-budgeted default prefix + content-hash wire name).
 * Declared indexes always survive unchanged; a second FK sharing an already
 * synthesized backing index does not mint a duplicate.
 */
export function materializeForeignKeysAndIndexes(
  tableName: string,
  foreignKeys: readonly ForeignKeyAuthoringInput[],
  declaredIndexes: readonly IndexInput[],
  uniques: readonly UniqueConstraintInput[],
  primaryKey: PrimaryKeyInput | undefined,
): MaterializedTableConstraints {
  const satisfiedIndexColumns = new Set(
    backingIndexColumnKeys({ indexes: declaredIndexes, uniques, primaryKey }),
  );
  const synthesizedIndexes: IndexInput[] = [];
  const materializedForeignKeys: ForeignKeyInput[] = [];

  for (const { constraint, index, ...reference } of foreignKeys) {
    if (constraint !== false) {
      materializedForeignKeys.push(reference);
    }
    if (index !== false) {
      const key = reference.source.columns.join(',');
      if (!satisfiedIndexColumns.has(key)) {
        synthesizedIndexes.push(
          lowerAuthoredIndex(tableName, {
            columns: reference.source.columns,
            where: undefined,
            unique: undefined,
            map: undefined,
            name: truncateToWireNamePrefixBytes(
              defaultIndexName(tableName, reference.source.columns),
            ),
            type: undefined,
            options: undefined,
          }),
        );
        satisfiedIndexColumns.add(key);
      }
    }
  }

  return {
    foreignKeys: materializedForeignKeys,
    indexes: [...declaredIndexes, ...synthesizedIndexes],
  };
}
