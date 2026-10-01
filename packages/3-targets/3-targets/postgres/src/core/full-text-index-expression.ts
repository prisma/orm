import { invariant } from '@internal/utils/assertions';
import { type } from 'arktype';
import { postgresError } from './errors';
import { FULL_TEXT_WEIGHTS, fullTextIndexOptions } from './index-types';
import { quoteIdentifier } from './sql-utils';
import type { FullTextSearchLanguage } from './text-search-languages';

/** Fields in order of weight: each inner list is one weight group, every field a storage column name. */
export type FullTextWeightGroups<Field> = readonly (readonly Field[])[];

/** A full-text index as the contract stores it in the index's `options`. */
export interface FullTextIndexDefinition {
  readonly fields: FullTextWeightGroups<string>;
  readonly language: FullTextSearchLanguage;
}

/** How one producer writes a field and the configuration. */
export interface FullTextDocumentSyntax<Field> {
  readonly column: (field: Field) => string;
  readonly language: string;
}

/**
 * The search document of a full-text index: the expression the index is built over and the one
 * `fullTextMatches` and `fullTextRank` search. Postgres uses an expression index only when the
 * query carries the same expression, so the index DDL, the schema node and the query operations
 * all render it here.
 *
 * One field alone is `to_tsvector(language, field)`. With more fields, each gets its own
 * `to_tsvector`, wrapped in `coalesce(field, '')` since one null would make the whole document
 * null, and they are joined with `||`. With more than one group, each field is weighted with its
 * group's weight, `A` for the first. The document depends on the groups and the language only, so
 * a column's nullability never changes it.
 */
export function renderFullTextDocument<Field>(
  groups: FullTextWeightGroups<Field>,
  syntax: FullTextDocumentSyntax<Field>,
): string {
  invariant(
    groups.length > 0 && groups.length <= FULL_TEXT_WEIGHTS.length,
    `a full-text document takes 1 to at most ${FULL_TEXT_WEIGHTS.length} weight groups, received ${groups.length}`,
  );
  invariant(
    groups.every((group) => group.length > 0),
    'a full-text document has an empty weight group',
  );
  const fieldCount = groups.reduce((count, group) => count + group.length, 0);
  const weighted = groups.length > 1;
  const vectors = groups.flatMap((group, position) =>
    group.map((field) => {
      const column = syntax.column(field);
      const text = fieldCount > 1 ? `coalesce(${column}, '')` : column;
      const vector = `to_tsvector(${syntax.language}, ${text})`;
      return weighted ? `setweight(${vector}, '${FULL_TEXT_WEIGHTS[position]}')` : vector;
    }),
  );
  return vectors.length === 1 ? (vectors[0] ?? '') : `(${vectors.join(' || ')})`;
}

/** The search document over storage columns, as the index DDL and the schema node carry it. */
export function renderFullTextIndexExpression(definition: FullTextIndexDefinition): string {
  return renderFullTextDocument(definition.fields, {
    column: quoteIdentifier,
    language: `'${definition.language}'`,
  });
}

/**
 * How an author lists the fields of a full-text index: one field, or a list whose items are fields
 * or lists of fields. Each top-level item is one weight group, strongest first.
 */
export type FullTextFieldsInput<Field> = Field | readonly (Field | readonly Field[])[];

export function weightGroupsOf<Field>(
  fields: FullTextFieldsInput<Field>,
  isField: (value: unknown) => value is Field,
): FullTextWeightGroups<Field> {
  if (isField(fields)) return [[fields]];
  return fields.map((item) => (isField(item) ? [item] : item));
}

/** What is wrong with a set of weight groups, in the order an author would fix it. */
export type FullTextWeightGroupProblem =
  | { readonly kind: 'no-fields' }
  | { readonly kind: 'too-many-groups'; readonly groupCount: number }
  | { readonly kind: 'empty-group'; readonly position: number }
  | { readonly kind: 'duplicate-field'; readonly field: string };

export function weightGroupProblems(
  groups: FullTextWeightGroups<string>,
): readonly FullTextWeightGroupProblem[] {
  const problems: FullTextWeightGroupProblem[] = [];
  if (groups.length === 0) problems.push({ kind: 'no-fields' });
  if (groups.length > FULL_TEXT_WEIGHTS.length) {
    problems.push({ kind: 'too-many-groups', groupCount: groups.length });
  }
  groups.forEach((group, position) => {
    if (group.length === 0) problems.push({ kind: 'empty-group', position });
  });
  const seen = new Set<string>();
  for (const field of groups.flat()) {
    if (seen.has(field)) problems.push({ kind: 'duplicate-field', field });
    seen.add(field);
  }
  return problems;
}

export function describeWeightGroupProblem(
  subject: string,
  problem: FullTextWeightGroupProblem,
): string {
  switch (problem.kind) {
    case 'no-fields':
      return `${subject} needs at least one field.`;
    case 'too-many-groups':
      return `${subject} takes at most ${FULL_TEXT_WEIGHTS.length} weight groups, one for each of the weights ${FULL_TEXT_WEIGHTS.join(', ')}, but was given ${problem.groupCount}.`;
    case 'empty-group':
      return `${subject} has an empty weight group at position ${problem.position + 1}.`;
    case 'duplicate-field':
      return `${subject} names the field "${problem.field}" more than once.`;
  }
}

/** The index type a full-text index is registered under. Its DDL is a `gin` index over its search document. */
export const FULL_TEXT_INDEX_TYPE = 'fullText';

interface IndexDeclaration {
  readonly name?: string | undefined;
  readonly type?: string | undefined;
  readonly unique?: boolean | undefined;
  readonly columns?: readonly string[] | undefined;
  readonly options?: Record<string, unknown> | undefined;
}

function invalidFullTextIndex(index: IndexDeclaration, problem: string, why: string) {
  return postgresError(
    'CONTRACT.INDEX_INVALID',
    `Full-text index "${index.name ?? '<unnamed>'}" ${problem}`,
    {
      why,
      fix: 'Re-emit the contract from its `@@fullTextIndex` or `fullTextIndex` source rather than editing the index by hand.',
      meta: { index: index.name, columns: index.columns, options: index.options },
    },
  );
}

/**
 * The definition a full-text index carries, or `undefined` for an index of any other type. It is
 * checked here, wherever it is read: the options must name one to four weight groups and a
 * language, and the index's `columns` must be exactly the fields of the groups, in order.
 */
export function fullTextIndexDefinitionOf(
  index: IndexDeclaration,
): FullTextIndexDefinition | undefined {
  if (index.type !== FULL_TEXT_INDEX_TYPE) return undefined;
  if (index.unique === true) {
    throw invalidFullTextIndex(
      index,
      'is unique.',
      'A full-text index is a gin index over its search document, and Postgres builds no unique gin index.',
    );
  }
  const definition = fullTextIndexOptions(index.options ?? {});
  if (definition instanceof type.errors) {
    throw invalidFullTextIndex(
      index,
      `has invalid options: ${definition.summary}`,
      'The options of a full-text index are its definition: its weight groups and its language.',
    );
  }
  const fields = definition.fields.flat();
  const columns = index.columns ?? [];
  if (columns.length !== fields.length || columns.some((column, i) => column !== fields[i])) {
    throw invalidFullTextIndex(
      index,
      `covers the columns [${columns.join(', ')}], but its weight groups name [${fields.join(', ')}].`,
      'The columns of a full-text index are the fields of its weight groups, in order. Foreign-key backing and the printer read the columns; the search document is rendered from the groups, so the two must agree.',
    );
  }
  return definition;
}
