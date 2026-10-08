import type {
  AuthoringWarning,
  AuthoringWarningSink,
} from '@internal/framework-components/authoring';
import { canonicalIndexContent } from '@internal/sql-schema-ir/naming';
import { ifDefined } from '@internal/utils/defined';
import type { PrimaryKeyInput } from './ir/primary-key';
import type { IndexInput } from './ir/sql-index';
import type { UniqueConstraintInput } from './ir/unique-constraint';

/** An index of a table as the contract source gives it, before duplicates are removed. */
export interface IndexCandidate {
  readonly index: IndexInput;
  /** The source gave the index a `name` or `map`. A derived backing index, and an index without either, are not named by the user. */
  readonly namedByUser: boolean;
}

/** What serves the lookups of an index the pass removed. */
export type IndexReplacement =
  | { readonly kind: 'index'; readonly index: IndexCandidate }
  | { readonly kind: 'uniqueConstraint'; readonly unique: UniqueConstraintInput }
  | { readonly kind: 'primaryKey'; readonly primaryKey: PrimaryKeyInput };

export interface DeduplicatedIndexes {
  /** The indexes the table keeps, in their original order. */
  readonly indexes: readonly IndexCandidate[];
  readonly replacements: ReadonlyMap<IndexCandidate, IndexReplacement>;
}

const IDENTICAL_DESCRIPTION =
  'they have the same columns, type, options, predicate and uniqueness. The contract keeps both because each is named.';

const REDUNDANT_DESCRIPTION = 'which already serves the same lookups.';

/**
 * Removes the indexes of one table that duplicate another. Two indexes are identical when their columns (in order), type, options, predicate, expression and uniqueness are equal; of an identical group the pass keeps the indexes named by the user, or the first one when none is. A plain non-unique index (columns only) whose columns are those of the primary key, a unique constraint or a unique index without a predicate is redundant, and the pass removes it unless it is named by the user. Every index named by the user survives; the pass warns about each one that duplicates another.
 */
export function deduplicateIndexes(input: {
  readonly tableName: string;
  readonly indexes: readonly IndexCandidate[];
  readonly uniques: readonly UniqueConstraintInput[];
  readonly primaryKey: PrimaryKeyInput | undefined;
  readonly warnings: AuthoringWarningSink;
}): DeduplicatedIndexes {
  const { tableName, warnings } = input;
  const replacements = new Map<IndexCandidate, IndexReplacement>();

  const groups = new Map<string, readonly [IndexCandidate, ...IndexCandidate[]]>();
  for (const candidate of input.indexes) {
    const content = contentOf(candidate.index);
    const group = groups.get(content);
    groups.set(content, group === undefined ? [candidate] : [...group, candidate]);
  }
  for (const group of groups.values()) {
    const named = group.filter((candidate) => candidate.namedByUser);
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
    const servedBy = uniqueLookupFor(candidate, survivors, input.uniques, input.primaryKey);
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

function contentOf(index: IndexInput): string {
  return canonicalIndexContent({
    ...ifDefined('columns', index.columns),
    ...ifDefined('expression', index.expression),
    ...ifDefined('where', index.where),
    unique: index.unique,
    ...ifDefined('type', index.type),
    ...ifDefined('options', index.options),
  });
}

function isPlainIndex(
  index: IndexInput,
): index is IndexInput & { readonly columns: readonly string[] } {
  return (
    index.columns !== undefined &&
    index.where === undefined &&
    index.type === undefined &&
    index.options === undefined
  );
}

function sameColumns(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((column, position) => column === b[position]);
}

function uniqueLookupFor(
  candidate: IndexCandidate,
  survivors: readonly IndexCandidate[],
  uniques: readonly UniqueConstraintInput[],
  primaryKey: PrimaryKeyInput | undefined,
): IndexReplacement | undefined {
  const { index } = candidate;
  if (index.unique || !isPlainIndex(index)) return undefined;
  if (primaryKey !== undefined && sameColumns(primaryKey.columns, index.columns)) {
    return { kind: 'primaryKey', primaryKey };
  }
  const unique = uniques.find((constraint) => sameColumns(constraint.columns, index.columns));
  if (unique !== undefined) return { kind: 'uniqueConstraint', unique };
  const uniqueIndex = survivors.find(
    (other) =>
      other.index.unique &&
      other.index.columns !== undefined &&
      other.index.where === undefined &&
      sameColumns(other.index.columns, index.columns),
  );
  return uniqueIndex === undefined ? undefined : { kind: 'index', index: uniqueIndex };
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

function describeReplacement(replacement: IndexReplacement): string {
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
  servedBy: IndexReplacement,
): AuthoringWarning {
  const name = writtenName(candidate.index);
  return {
    code: 'PN_INDEX_REDUNDANT',
    message: `Index "${name}" on table "${tableName}" has the same columns as ${describeReplacement(servedBy)}, ${REDUNDANT_DESCRIPTION} The contract keeps the index because it is named. Remove it.`,
    item: `table "${tableName}": index "${name}"`,
    summary: `tables have a named index with the same columns as a unique constraint, unique index or primary key, ${REDUNDANT_DESCRIPTION} The contract keeps each index because it is named. Remove them.`,
  };
}
