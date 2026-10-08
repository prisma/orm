import type { AuthoringWarningSink } from '@internal/framework-components/authoring';
import {
  defaultIndexName,
  nameOf,
  truncateToWireNamePrefixBytes,
} from '@internal/sql-schema-ir/naming';
import { contractError } from './contract-errors';
import {
  deduplicateIndexes,
  type IndexCandidate,
  type IndexReplacement,
  writtenName,
} from './index-deduplication';
import { lowerAuthoredIndex } from './index-naming';
import type { ForeignKeyIndex, ForeignKeyInput, ReferentialAction } from './ir/foreign-key';
import type { ForeignKeyReferenceInput } from './ir/foreign-key-reference';
import type { PrimaryKeyInput } from './ir/primary-key';
import type { IndexInput } from './ir/sql-index';
import type { UniqueConstraintInput } from './ir/unique-constraint';

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
  const backed = input.foreignKeys.map((foreignKey) => {
    const { constraint, index, ...reference } = foreignKey;
    if (index === false) return { constraint, reference, backing: undefined };
    if (index === true) {
      const derived = derivedBackingIndex(tableName, reference.source.columns);
      derivedIndexes.push(derived);
      return { constraint, reference, backing: { kind: 'index', index: derived } as const };
    }
    return {
      constraint,
      reference,
      backing: declaredBackingObject(tableName, reference.source.columns, index, {
        declaredIndexes,
        uniques,
        primaryKey,
      }),
    };
  });

  const deduplicated = deduplicateIndexes({
    tableName,
    indexes: [...declaredIndexes, ...derivedIndexes],
    uniques,
    primaryKey,
    warnings: input.warnings,
  });

  return {
    foreignKeys: backed.flatMap(({ constraint, reference, backing }) => {
      if (!constraint) return [];
      if (backing === undefined) return [reference];
      return [
        {
          ...reference,
          index: foreignKeyIndexOf(resolveReplacement(backing, deduplicated.replacements)),
        },
      ];
    }),
    indexes: deduplicated.indexes.map((candidate) => candidate.index),
  };
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

function declaredBackingObject(
  tableName: string,
  columns: readonly string[],
  name: string,
  table: {
    readonly declaredIndexes: readonly IndexCandidate[];
    readonly uniques: readonly UniqueConstraintInput[];
    readonly primaryKey: PrimaryKeyInput | undefined;
  },
): IndexReplacement {
  const subject = `The foreign key on table "${tableName}" columns (${columns.join(', ')}) names "${name}" as its index`;
  const indexes = table.declaredIndexes.filter(
    (candidate) => writtenName(candidate.index) === name || nameOf(candidate.index.naming) === name,
  );
  const [index, ...others] = indexes;
  if (others.length > 0) {
    throw contractError(
      'CONTRACT.ARGUMENT_INVALID',
      `${subject}, but table "${tableName}" has more than one index with that name.`,
      { meta: { tableName, columns, index: name } },
    );
  }
  if (index !== undefined) return { kind: 'index', index };
  const unique = table.uniques.find((constraint) => constraint.name === name);
  const key = unique ?? (table.primaryKey?.name === name ? table.primaryKey : undefined);
  if (key !== undefined && !sameColumns(key.columns, columns)) {
    throw contractError(
      'CONTRACT.ARGUMENT_INVALID',
      `${subject}, but that key is on columns (${key.columns.join(', ')}); a unique constraint or primary key backs a foreign key only on exactly its columns.`,
      {
        fix: 'Name an index whose columns serve the foreign key, or drop the index argument so the foreign key gets its own backing index.',
        meta: { tableName, columns, index: name },
      },
    );
  }
  if (unique !== undefined) return { kind: 'uniqueConstraint', unique };
  if (key !== undefined) return { kind: 'primaryKey', primaryKey: key };
  throw contractError(
    'CONTRACT.ARGUMENT_INVALID',
    `${subject}, but table "${tableName}" has no index, unique constraint or primary key with that name.`,
    {
      fix: `Declare an index, unique constraint or primary key named "${name}" on table "${tableName}", or drop the index argument so the foreign key gets its own backing index.`,
      meta: { tableName, columns, index: name },
    },
  );
}

function resolveReplacement(
  backing: IndexReplacement,
  replacements: ReadonlyMap<IndexCandidate, IndexReplacement>,
): IndexReplacement {
  let current = backing;
  while (current.kind === 'index') {
    const replacement = replacements.get(current.index);
    if (replacement === undefined) break;
    current = replacement;
  }
  return current;
}

function sameColumns(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((column, position) => column === b[position]);
}

function foreignKeyIndexOf(backing: IndexReplacement): ForeignKeyIndex {
  switch (backing.kind) {
    case 'index':
      return { name: nameOf(backing.index.index.naming) };
    case 'uniqueConstraint':
      return { unique: true };
    case 'primaryKey':
      return { primaryKey: true };
  }
}
