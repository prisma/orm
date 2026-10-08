import { asNamespaceId } from '@internal/contract/types';
import type { AuthoringWarningSink } from '@internal/framework-components/authoring';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import {
  defaultIndexName,
  nameOf,
  truncateToWireNamePrefixBytes,
} from '@internal/sql-schema-ir/naming';
import { contractError } from './contract-errors';
import {
  type BackingObject,
  deduplicateIndexes,
  type IndexCandidate,
  writtenName,
} from './index-deduplication';
import {
  derivedBackingIndexIsRedundant,
  indexNodeOf,
  leadingBackingObjectName,
  startsWithColumns,
} from './index-equivalence';
import { lowerAuthoredIndex } from './index-naming';
import type { ForeignKeyIndex, ForeignKeyInput, ReferentialAction } from './ir/foreign-key';
import type { ForeignKeyReferenceInput } from './ir/foreign-key-reference';
import type { PrimaryKeyInput } from './ir/primary-key';
import type { IndexInput } from './ir/sql-index';
import type { UniqueConstraintInput } from './ir/unique-constraint';

/** The `meta.reason` of the refusal of a relation's `index: "<name>"`, which a source can report at the relation. */
export const FOREIGN_KEY_INDEX_UNRESOLVED = 'foreign-key-index-unresolved';

/**
 * A foreign key as authored: the referential coordinates plus the `constraint` and `index` intent. `index` is `true` for a derived backing index, `false` for none, or the name of an index, unique constraint or primary key the source declares on the same table.
 */
export interface ForeignKeyAuthoringInput {
  readonly source: ForeignKeyReferenceInput;
  readonly target: ForeignKeyReferenceInput;
  readonly name?: string;
  readonly onDelete?: ReferentialAction;
  readonly onUpdate?: ReferentialAction;
  readonly constraint: boolean;
  readonly index: boolean | string;
}

export interface MaterializedTableConstraints {
  readonly foreignKeys: readonly ForeignKeyInput[];
  readonly indexes: readonly IndexInput[];
}

/**
 * Lowers a table's authored foreign keys and indexes into the entities `contract.json` persists. A `constraint: false` foreign key contributes no `foreignKeys[]` entry. A foreign key with `index: true` gets a derived backing index; one with `index: "<name>"` uses what the table declares under that name. The table's indexes then pass through {@link deduplicateIndexes}, and each foreign key states what backs it in the result: an index by name, or the primary key or a unique constraint by kind.
 */
export function materializeForeignKeysAndIndexes(input: {
  readonly tableName: string;
  readonly foreignKeys: readonly ForeignKeyAuthoringInput[];
  readonly declaredIndexes: readonly IndexCandidate[];
  readonly uniques: readonly UniqueConstraintInput[];
  readonly primaryKey: PrimaryKeyInput | undefined;
  readonly warnings: AuthoringWarningSink;
}): MaterializedTableConstraints {
  const { tableName, declaredIndexes, uniques, primaryKey } = input;
  const derivedIndexes: IndexCandidate[] = [];
  const intents = input.foreignKeys.map((foreignKey) => {
    const { constraint, index, ...reference } = foreignKey;
    if (index !== true) return { constraint, reference, index };
    const derived = derivedBackingIndex(tableName, reference.source.columns);
    derivedIndexes.push(derived);
    return { constraint, reference, index: derived };
  });

  const deduplicated = deduplicateIndexes({
    tableName,
    indexes: [...declaredIndexes, ...derivedIndexes],
    uniques,
    primaryKey,
    warnings: input.warnings,
  });
  const resolve = (backing: BackingObject) =>
    foreignKeyIndexOf(resolveReplacement(backing, deduplicated.replacements));

  return {
    foreignKeys: intents.flatMap(({ constraint, reference, index }) => {
      const backing =
        index === false
          ? undefined
          : typeof index === 'string'
            ? namedBackingObject(reference.source, index, {
                declaredIndexes,
                uniques,
                primaryKey,
                resolve,
              })
            : resolve({ kind: 'index', index });
      if (!constraint) return [];
      return [backing === undefined ? reference : { ...reference, index: backing }];
    }),
    indexes: deduplicated.indexes.map((candidate) => candidate.index),
  };
}

/**
 * Whether a table's declared indexes, unique constraints or primary key already serve a foreign key on `columns`, so the build would drop a derived backing index again. A source that writes no backing index of its own, such as a Prisma 7 schema, leaves the foreign key's `index` to the build where this holds, so the stored foreign key states what backs it.
 */
export function declaredIndexesServeForeignKey(
  columns: readonly string[],
  table: {
    readonly indexes: readonly IndexInput[];
    readonly uniques: readonly UniqueConstraintInput[];
    readonly primaryKey: PrimaryKeyInput | undefined;
  },
): boolean {
  return derivedBackingIndexIsRedundant(columns, {
    indexes: table.indexes,
    nodeOf: indexNodeOf,
    uniques: table.uniques,
    primaryKey: table.primaryKey,
  });
}

/**
 * The name to give a relation's `index` argument when the table's declared indexes and keys serve a foreign key on `columns` although the build would keep a derived backing index beside them (see {@link leadingBackingObjectName}).
 */
export function declaredBackingObjectName(
  columns: readonly string[],
  table: {
    readonly indexes: readonly IndexInput[];
    readonly uniques: readonly UniqueConstraintInput[];
    readonly primaryKey: PrimaryKeyInput | undefined;
  },
): string | undefined {
  return leadingBackingObjectName(columns, {
    indexes: table.indexes,
    nodeOf: indexNodeOf,
    nameOf: (index) => nameOf(index.naming),
    uniques: table.uniques,
    primaryKey: table.primaryKey,
  });
}

/**
 * What a foreign key on `columns` states it is backed by when its relation says nothing, beside a table whose indexes all carry the `name` or `map` the source gave them, as a printed contract's do. A printer writes a relation's `index` argument only where the stored foreign key differs from this.
 */
export function defaultForeignKeyIndex(
  tableName: string,
  columns: readonly string[],
  table: {
    readonly indexes: readonly IndexInput[];
    readonly uniques: readonly UniqueConstraintInput[];
    readonly primaryKey: PrimaryKeyInput | undefined;
  },
): ForeignKeyIndex | undefined {
  const reference = { namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID), tableName, columns };
  const [foreignKey] = materializeForeignKeysAndIndexes({
    tableName,
    foreignKeys: [{ source: reference, target: reference, constraint: true, index: true }],
    declaredIndexes: table.indexes.map((index) => ({ index, namedByUser: true })),
    uniques: table.uniques,
    primaryKey: table.primaryKey,
    warnings: [],
  }).foreignKeys;
  return typeof foreignKey?.index === 'object' ? foreignKey.index : undefined;
}

function derivedBackingIndex(tableName: string, columns: readonly string[]): IndexCandidate {
  return {
    index: lowerAuthoredIndex(tableName, {
      columns,
      where: undefined,
      unique: undefined,
      map: undefined,
      name: truncateToWireNamePrefixBytes(defaultIndexName(tableName, columns)),
      type: undefined,
      options: undefined,
    }),
    namedByUser: false,
  };
}

/**
 * What a relation's `index: "<name>"` points at. The name is the `name` or `map` the source gave an index, unique constraint or primary key, or an index's stored name; an unnamed index's default name does not count. Identical indexes count as one, so the name is resolved after they merge. The object must start with the foreign key's columns, in order, or it would not serve the foreign key's lookups.
 */
function namedBackingObject(
  source: ForeignKeyReferenceInput,
  name: string,
  table: {
    readonly declaredIndexes: readonly IndexCandidate[];
    readonly uniques: readonly UniqueConstraintInput[];
    readonly primaryKey: PrimaryKeyInput | undefined;
    readonly resolve: (backing: BackingObject) => ForeignKeyIndex;
  },
): ForeignKeyIndex {
  const { namespaceId, tableName, columns } = source;
  const subject = `The foreign key on table "${tableName}" columns (${columns.join(', ')}) names "${name}" as its index`;
  const meta = {
    reason: FOREIGN_KEY_INDEX_UNRESOLVED,
    namespaceId,
    tableName,
    columns,
    index: name,
  };
  const indexes = table.declaredIndexes.filter(
    (candidate) =>
      (candidate.namedByUser && writtenName(candidate.index) === name) ||
      nameOf(candidate.index.naming) === name,
  );
  const keys = [
    ...table.uniques.filter((unique) => unique.name === name),
    ...(table.primaryKey?.name === name ? [table.primaryKey] : []),
  ];
  const resolvedIndexes = [
    ...new Map(
      indexes.map((index) => {
        const resolved = table.resolve({ kind: 'index', index });
        return [JSON.stringify(resolved), { index, resolved }] as const;
      }),
    ).values(),
  ];
  const matches = resolvedIndexes.length + keys.length;
  if (matches === 0) {
    throw contractError(
      'CONTRACT.ARGUMENT_INVALID',
      `${subject}, but table "${tableName}" has no index, unique constraint or primary key with that name.`,
      {
        fix: `Declare an index, unique constraint or primary key named "${name}" on table "${tableName}", or drop the index argument so the foreign key gets its own backing index.`,
        meta,
      },
    );
  }
  if (matches > 1) {
    throw contractError(
      'CONTRACT.ARGUMENT_INVALID',
      `${subject}, but table "${tableName}" has more than one index, unique constraint or primary key with that name.`,
      {
        fix: `Give the object the foreign key should use a name no other index, unique constraint or primary key of table "${tableName}" has, and name that on the relation.`,
        meta,
      },
    );
  }
  const [match] = resolvedIndexes;
  const key = keys[0];
  const objectColumns = match !== undefined ? match.index.index.columns : key?.columns;
  if (objectColumns === undefined || !startsWithColumns(objectColumns, columns)) {
    const reason =
      objectColumns === undefined
        ? "it indexes an expression, not the foreign key's columns"
        : `its columns (${objectColumns.join(', ')}) do not start with the foreign key's columns`;
    throw contractError(
      'CONTRACT.ARGUMENT_INVALID',
      `${subject}, but ${reason}, so it does not serve the foreign key's lookups.`,
      {
        fix: `Name an index, unique constraint or primary key whose first columns are (${columns.join(', ')}), or drop the index argument so the foreign key gets its own backing index.`,
        meta,
      },
    );
  }
  if (match !== undefined) return match.resolved;
  return key === table.primaryKey ? { primaryKey: true } : { unique: objectColumns };
}

function resolveReplacement(
  backing: BackingObject,
  replacements: ReadonlyMap<IndexCandidate, BackingObject>,
): BackingObject {
  let current = backing;
  while (current.kind === 'index') {
    const replacement = replacements.get(current.index);
    if (replacement === undefined) break;
    current = replacement;
  }
  return current;
}

function foreignKeyIndexOf(backing: BackingObject): ForeignKeyIndex {
  switch (backing.kind) {
    case 'index':
      return { name: nameOf(backing.index.index.naming) };
    case 'uniqueConstraint':
      return { unique: backing.unique.columns };
    case 'primaryKey':
      return { primaryKey: true };
  }
}
