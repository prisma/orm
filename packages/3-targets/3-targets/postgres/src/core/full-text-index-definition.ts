import type { Index as StorageIndex, StorageTable } from '@internal/sql-contract/types';
import { invariant } from '@internal/utils/assertions';
import { type } from 'arktype';
import { postgresError } from './errors';
import { FULL_TEXT_WEIGHTS, type FullTextWeightGroups } from './full-text-weight-groups';
import {
  type FullTextSearchLanguage,
  POSTGRES_TEXT_SEARCH_LANGUAGES,
} from './text-search-languages';

/** The index type a full-text index is registered under. */
export const FULL_TEXT_INDEX_TYPE = 'fullText';

/** The traits the codec of every column a full-text index covers must carry. */
export const FULL_TEXT_COLUMN_TRAITS = ['textual'] as const;

/** A full-text index as the contract stores it in the index's `options`. */
export interface FullTextIndexDefinition {
  /** The weight groups, strongest first, as storage column names. */
  readonly weightGroups: FullTextWeightGroups<string>;
  readonly language: FullTextSearchLanguage;
}

/** How the codec of a column is found, for the rule that a full-text index covers text columns only. */
export interface FullTextColumnCodecs {
  /** The codec a column stores its values through; `undefined` for a field that stores no value. */
  readonly codecIdOf: (column: string) => string | undefined;
  /** The traits of a codec; `undefined` for a codec nobody registered. */
  readonly traitsOf: (codecId: string) => readonly string[] | undefined;
}

/** A full-text index, or part of one, to check against the rules of {@link fullTextIndexProblems}. */
export interface FullTextIndexCandidate {
  readonly weightGroups: FullTextWeightGroups<string>;
  readonly unique?: boolean | undefined;
  /** Checks the text-columns rule when given; a site that cannot see the codecs leaves it out. */
  readonly codecs?: FullTextColumnCodecs | undefined;
}

/** What is wrong with a full-text index, in the order an author would fix it. */
export type FullTextIndexProblem =
  | { readonly kind: 'no-fields' }
  | { readonly kind: 'too-many-groups'; readonly groupCount: number }
  | { readonly kind: 'empty-group'; readonly position: number }
  | { readonly kind: 'duplicate-field'; readonly field: string }
  | { readonly kind: 'not-text'; readonly field: string; readonly codecId: string | undefined }
  | { readonly kind: 'unique' };

/**
 * The rules of a full-text index, stated once: one to four weight groups, none empty, each field
 * once, text columns only, and not unique. Every site that checks a full-text index calls this.
 */
export function fullTextIndexProblems(
  candidate: FullTextIndexCandidate,
): readonly FullTextIndexProblem[] {
  const { weightGroups } = candidate;
  const problems: FullTextIndexProblem[] = [];
  if (weightGroups.length === 0) problems.push({ kind: 'no-fields' });
  if (weightGroups.length > FULL_TEXT_WEIGHTS.length) {
    problems.push({ kind: 'too-many-groups', groupCount: weightGroups.length });
  }
  weightGroups.forEach((group, position) => {
    if (group.length === 0) problems.push({ kind: 'empty-group', position });
  });
  const seen = new Set<string>();
  for (const field of weightGroups.flat()) {
    if (seen.has(field)) problems.push({ kind: 'duplicate-field', field });
    seen.add(field);
  }
  const { codecs } = candidate;
  if (codecs !== undefined) {
    for (const field of new Set(weightGroups.flat())) {
      const codecId = codecs.codecIdOf(field);
      if (codecId === undefined || !carriesFullTextTraits(codecs.traitsOf(codecId))) {
        problems.push({ kind: 'not-text', field, codecId });
      }
    }
  }
  if (candidate.unique === true) problems.push({ kind: 'unique' });
  return problems;
}

function carriesFullTextTraits(traits: readonly string[] | undefined): boolean {
  return traits !== undefined && FULL_TEXT_COLUMN_TRAITS.every((trait) => traits.includes(trait));
}

export function describeFullTextIndexProblem(
  subject: string,
  problem: FullTextIndexProblem,
  fieldLabel: (field: string) => string = (field) => field,
): string {
  switch (problem.kind) {
    case 'no-fields':
      return `${subject} needs at least one field.`;
    case 'too-many-groups':
      return `${subject} takes at most ${FULL_TEXT_WEIGHTS.length} weight groups, one for each of the weights ${FULL_TEXT_WEIGHTS.join(', ')}, but was given ${problem.groupCount}.`;
    case 'empty-group':
      return `${subject} has an empty weight group at position ${problem.position + 1}.`;
    case 'duplicate-field':
      return `${subject} names the field "${fieldLabel(problem.field)}" more than once.`;
    case 'not-text':
      return `${subject} indexes text columns, but "${fieldLabel(problem.field)}" is ${problem.codecId === undefined ? 'not a stored scalar field' : `stored as \`${problem.codecId}\``}.`;
    case 'unique':
      return `${subject} is unique, but Postgres builds no unique gin index.`;
  }
}

/** The options of a full-text index: its weight groups, as storage column names, and its language. */
export const fullTextIndexOptions = type({
  '+': 'reject',
  weightGroups: type('string > 0')
    .array()
    .array()
    .narrow((weightGroups, ctx) => {
      const [problem] = fullTextIndexProblems({ weightGroups });
      return (
        problem === undefined ||
        ctx.reject({ message: describeFullTextIndexProblem('a full-text index', problem) })
      );
    }),
  language: type.enumerated(...POSTGRES_TEXT_SEARCH_LANGUAGES),
});

/**
 * The registration of the full-text index type. Its options are the index's definition, not
 * storage parameters, and the target turns them into a `gin` index over the rendered search
 * document.
 */
export const fullTextIndexType = {
  options: fullTextIndexOptions,
  accessMethod: 'gin',
  columnTraits: FULL_TEXT_COLUMN_TRAITS,
};

/**
 * The definition a full-text index carries, or `undefined` for an index of any other type. It
 * reads an index {@link assertFullTextIndexes} has accepted, as every loaded contract's has been.
 */
export function fullTextIndexDefinitionOf(
  index: Pick<StorageIndex, 'type' | 'options'>,
): FullTextIndexDefinition | undefined {
  if (index.type !== FULL_TEXT_INDEX_TYPE) return undefined;
  const definition = fullTextIndexOptions(index.options ?? {});
  invariant(
    !(definition instanceof type.errors),
    'a full-text index is read only after its contract was checked',
  );
  return definition;
}

/**
 * Refuses a table's full-text index the contract cannot carry: invalid options, a broken rule of
 * {@link fullTextIndexProblems}, or `columns` that are not the fields of its weight groups, in order.
 * The text-columns rule is checked only when `traitsOf` is given.
 */
export function assertFullTextIndexes(
  table: Pick<StorageTable, 'columns' | 'indexes'>,
  traitsOf?: (codecId: string) => readonly string[] | undefined,
): void {
  const codecs =
    traitsOf === undefined
      ? undefined
      : { codecIdOf: (column: string) => table.columns[column]?.codecId, traitsOf };
  for (const index of table.indexes) assertFullTextIndex(index, codecs);
}

function assertFullTextIndex(
  index: Pick<StorageIndex, 'name' | 'unique' | 'columns' | 'type' | 'options'>,
  codecs: FullTextColumnCodecs | undefined,
): void {
  if (index.type !== FULL_TEXT_INDEX_TYPE) return;
  const definition = fullTextIndexOptions(index.options ?? {});
  if (definition instanceof type.errors) {
    throw invalidFullTextIndex(
      index,
      `Full-text index "${index.name}" has invalid options: ${definition.summary}`,
      'The options of a full-text index are its definition: its weight groups and its language.',
    );
  }
  const [problem] = fullTextIndexProblems({
    weightGroups: definition.weightGroups,
    unique: index.unique,
    codecs,
  });
  if (problem !== undefined) {
    throw invalidFullTextIndex(
      index,
      describeFullTextIndexProblem(`Full-text index "${index.name}"`, problem),
      'A full-text index is a gin index over text columns, in one to four weight groups that name each column once.',
    );
  }
  const fields = definition.weightGroups.flat();
  const columns = index.columns ?? [];
  if (columns.length !== fields.length || columns.some((column, i) => column !== fields[i])) {
    throw invalidFullTextIndex(
      index,
      `Full-text index "${index.name}" covers the columns [${columns.join(', ')}], but its weight groups name [${fields.join(', ')}].`,
      'The columns of a full-text index are the fields of its weight groups, in order. Foreign-key backing and the printer read the columns; the search document is rendered from the groups, so the two must agree.',
    );
  }
}

function invalidFullTextIndex(
  index: Pick<StorageIndex, 'name' | 'columns' | 'options'>,
  message: string,
  why: string,
) {
  return postgresError('CONTRACT.INDEX_INVALID', message, {
    why,
    fix: 'Re-emit the contract from its `@@fullTextIndex` or `fullTextIndex` source rather than editing the index by hand.',
    meta: { index: index.name, columns: index.columns, options: index.options },
  });
}
