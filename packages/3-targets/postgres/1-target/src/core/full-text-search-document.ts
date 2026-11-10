import { assertDefined } from '@internal/utils/assertions';
import { postgresError } from './errors';
import {
  describeFullTextIndexProblem,
  type FullTextIndexDefinition,
  fullTextIndexProblems,
} from './full-text-index-definition';
import { FULL_TEXT_WEIGHTS, type FullTextWeightGroups } from './full-text-weight-groups';
import { quoteIdentifier } from './sql-utils';

/** How one producer writes a column of the search document, and the text-search configuration. */
export interface FullTextDocumentWriter<Field> {
  readonly column: (field: Field) => string;
  readonly language: string;
}

/**
 * The search document of a full-text index: the expression the index is built over and the one
 * `fullTextMatches` and `fullTextRank` search. Postgres uses an expression index only when the
 * query carries the same expression, so the index DDL, the schema node and the query operations
 * all render it here, from weight groups their callers have already checked.
 *
 * One field alone is `to_tsvector(language, field)`. With more fields, each gets its own
 * `to_tsvector`, wrapped in `coalesce(field, '')` since one null would make the whole document
 * null, and they are joined with `||`. With more than one group, each field is weighted with its
 * group's weight, `A` for the first. The document depends on the groups and the language only, so
 * a column's nullability never changes it.
 */
export function renderFullTextDocument<Field>(
  groups: FullTextWeightGroups<Field>,
  writer: FullTextDocumentWriter<Field>,
): string {
  const fieldCount = groups.reduce((count, group) => count + group.length, 0);
  const weighted = groups.length > 1;
  const vectors = groups.flatMap((group, position) =>
    group.map((field) => {
      const column = writer.column(field);
      const text = fieldCount > 1 ? `coalesce(${column}, '')` : column;
      const vector = `to_tsvector(${writer.language}, ${text})`;
      if (!weighted) return vector;
      const weight = FULL_TEXT_WEIGHTS[position];
      assertDefined(weight, `a full-text document has no weight for group ${position + 1}`);
      return `setweight(${vector}, '${weight}')`;
    }),
  );
  const [only] = vectors;
  assertDefined(only, 'a full-text document has at least one field');
  return vectors.length === 1 ? only : `(${vectors.join(' || ')})`;
}

/**
 * The search document over storage columns, as the index DDL and the schema node carry it. A
 * definition that breaks a rule of a full-text index is refused.
 */
export function renderFullTextIndexDocument(definition: FullTextIndexDefinition): string {
  const { weightGroups } = definition;
  const [problem] = fullTextIndexProblems({ weightGroups });
  if (problem !== undefined) {
    throw postgresError(
      'CONTRACT.INDEX_INVALID',
      describeFullTextIndexProblem('The full-text index definition', problem),
      {
        why: 'Each field of a search document is weighted by the position of its group, so the document is rendered only from weight groups that follow the rules of a full-text index.',
        fix: 'Pass one to four non-empty weight groups that name each column once.',
        meta: { weightGroups },
      },
    );
  }
  return renderFullTextDocument(weightGroups, {
    column: quoteIdentifier,
    language: `'${definition.language}'`,
  });
}
