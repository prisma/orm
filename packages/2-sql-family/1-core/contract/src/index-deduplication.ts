import type {
  AuthoringWarning,
  AuthoringWarningSink,
} from '@internal/framework-components/authoring';
import type { SqlIndexIR } from '@internal/sql-schema-ir/types';
import { InternalError } from '@internal/utils/internal-error';
import type { StructuredError } from '@internal/utils/structured-error';
import { contractError } from './contract-errors';
import { identicalIndexes, indexNodeOf, type ServingKey, servingKey } from './index-equivalence';
import type { PrimaryKeyInput } from './ir/primary-key';
import type { IndexInput } from './ir/sql-index';
import type { UniqueConstraintInput } from './ir/unique-constraint';

/** An index of a table as the contract source gives it, before duplicates are removed. */
export interface IndexCandidate {
  readonly index: IndexInput;
  /** The source gave the index a `name` or `map`. A derived backing index, and an index without either, are not named by the user. */
  readonly namedByUser: boolean;
}

/** What backs a foreign key, or serves the lookups of an index the pass removed. */
export type BackingObject = ServingKey<IndexCandidate, UniqueConstraintInput, PrimaryKeyInput>;

export interface DeduplicatedIndexes {
  /** The indexes the table keeps, in their original order. */
  readonly indexes: readonly IndexCandidate[];
  readonly replacements: ReadonlyMap<IndexCandidate, BackingObject>;
}

const IDENTICAL_DESCRIPTION =
  'the planner sees them as the same index. The contract keeps both because each is named.';

const REDUNDANT_DESCRIPTION = 'which already serves the same lookups.';

/**
 * Removes the indexes of one table that duplicate another. Two indexes are identical when the planner sees them as the same index apart from their names (see {@link identicalIndexes}); of an identical group the pass keeps the indexes named by the user, or the first one when none is. A plain non-unique index whose columns are those of the primary key, a unique constraint or a unique index without a predicate is redundant (see {@link servingKey}), and the pass removes it unless it is named by the user. Every index named by the user survives; the pass warns about each one that duplicates another, and refuses two identical indexes both named with `name:`, whose wire names the planner could not tell apart.
 */
export function deduplicateIndexes(input: {
  readonly tableName: string;
  readonly indexes: readonly IndexCandidate[];
  readonly uniques: readonly UniqueConstraintInput[];
  readonly primaryKey: PrimaryKeyInput | undefined;
  readonly warnings: AuthoringWarningSink;
}): DeduplicatedIndexes {
  const { tableName, warnings } = input;
  const replacements = new Map<IndexCandidate, BackingObject>();
  const nodes = new Map(
    input.indexes.map((candidate) => [candidate, indexNodeOf(candidate.index)]),
  );
  const nodeOf = (candidate: IndexCandidate): SqlIndexIR => {
    const node = nodes.get(candidate);
    if (node === undefined) throw new InternalError('every candidate has a node');
    return node;
  };

  const groups: (readonly [IndexCandidate, ...IndexCandidate[]])[] = [];
  for (const candidate of input.indexes) {
    const position = groups.findIndex(([first]) =>
      identicalIndexes(nodeOf(first), nodeOf(candidate)),
    );
    const group = groups[position];
    if (group === undefined) groups.push([candidate]);
    else groups[position] = [...group, candidate];
  }
  for (const group of groups) {
    const named = group.filter((candidate) => candidate.namedByUser);
    const wireNamed = named.filter((candidate) => candidate.index.naming.kind === 'wire');
    if (wireNamed.length > 1) {
      throw identicalWireNamedIndexesError(tableName, wireNamed);
    }
    const kept = named[0] ?? group[0];
    for (const candidate of group) {
      if (candidate !== kept && !candidate.namedByUser) {
        replacements.set(candidate, { kind: 'index', index: kept });
      }
    }
    if (named.length > 1) {
      warnings.push(identicalIndexesWarning(tableName, named));
    }
  }

  const survivors = input.indexes.filter((candidate) => !replacements.has(candidate));
  for (const candidate of survivors) {
    const servedBy = servingKey(nodeOf(candidate), {
      indexes: survivors,
      nodeOf,
      uniques: input.uniques,
      primaryKey: input.primaryKey,
    });
    if (servedBy === undefined) continue;
    if (candidate.namedByUser) {
      warnings.push(redundantIndexWarning(tableName, candidate, servedBy));
    } else {
      replacements.set(candidate, servedBy);
    }
  }

  return {
    indexes: input.indexes.filter((candidate) => !replacements.has(candidate)),
    replacements,
  };
}

function identicalWireNamedIndexesError(
  tableName: string,
  wireNamed: readonly IndexCandidate[],
): StructuredError {
  const names = quotedList(wireNamed.map((candidate) => writtenName(candidate.index)));
  return contractError(
    'CONTRACT.ARGUMENT_INVALID',
    `Indexes ${names} on table "${tableName}" are identical and both named with name:; the planner pairs wire-named indexes by their content, so it could not tell them apart.`,
    {
      fix: 'Remove one of them, or name one with map: to keep both under exact names.',
      meta: { tableName, indexes: wireNamed.map((candidate) => writtenName(candidate.index)) },
    },
  );
}

/** The name the source wrote: the prefix of a wire-named index, the whole name of an exact one. */
export function writtenName(index: IndexInput): string {
  return index.naming.kind === 'wire' ? index.naming.prefix : index.naming.name;
}

function quotedList(names: readonly string[]): string {
  const quoted = names.map((name) => `"${name}"`);
  return quoted.length <= 2
    ? quoted.join(' and ')
    : `${quoted.slice(0, -1).join(', ')} and ${quoted.at(-1)}`;
}

function identicalIndexesWarning(
  tableName: string,
  named: readonly IndexCandidate[],
): AuthoringWarning {
  const names = quotedList(named.map((candidate) => writtenName(candidate.index)));
  return {
    code: 'PN_INDEX_DUPLICATE',
    message: `Indexes ${names} on table "${tableName}" are identical: ${IDENTICAL_DESCRIPTION} Remove one of them.`,
    item: `table "${tableName}": indexes ${names}`,
    summary: `tables have named indexes that are identical: ${IDENTICAL_DESCRIPTION} Remove one of each.`,
  };
}

function describeReplacement(replacement: BackingObject): string {
  switch (replacement.kind) {
    case 'primaryKey':
      return 'the primary key';
    case 'uniqueConstraint':
      return replacement.unique.name === undefined
        ? `the unique constraint on (${replacement.unique.columns.join(', ')})`
        : `the unique constraint "${replacement.unique.name}"`;
    case 'index':
      return `the unique index "${writtenName(replacement.index.index)}"`;
  }
}

function redundantIndexWarning(
  tableName: string,
  candidate: IndexCandidate,
  servedBy: BackingObject,
): AuthoringWarning {
  const name = writtenName(candidate.index);
  return {
    code: 'PN_INDEX_REDUNDANT',
    message: `Index "${name}" on table "${tableName}" has the same columns as ${describeReplacement(servedBy)}, ${REDUNDANT_DESCRIPTION} The contract keeps the index because it is named. Remove it.`,
    item: `table "${tableName}": index "${name}"`,
    summary: `tables have a named index with the same columns as a unique constraint, unique index or primary key, ${REDUNDANT_DESCRIPTION} The contract keeps each index because it is named. Remove them.`,
  };
}
