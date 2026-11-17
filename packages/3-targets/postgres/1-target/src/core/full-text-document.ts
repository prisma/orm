import type { TraitExpression } from '@internal/sql-relational-core/expression';
import type { ExtractedCodecTypes } from './codec-type-map';
import { postgresError } from './errors';
import { describeFullTextIndexProblem, fullTextIndexProblems } from './full-text-index-definition';
import {
  FULL_TEXT_WEIGHTS,
  type FullTextWeightGroups,
  weightGroupsOf,
} from './full-text-weight-groups';

/** A textual column, nullable or not, as an expression rather than a value. */
export type FullTextDocumentColumn = Extract<
  TraitExpression<readonly ['textual'], boolean, ExtractedCodecTypes>,
  { buildAst(): unknown }
>;

/**
 * The weight groups of a search document: each item is one group, strongest first, either one
 * column or a list of columns.
 */
export type FullTextDocumentGroups = readonly (
  | FullTextDocumentColumn
  | readonly FullTextDocumentColumn[]
)[];

/**
 * A search document built from columns in weight groups, for `fullTextMatches` and `fullTextRank`
 * to search without a full-text index. Postgres uses an index only for a query over the same
 * document, so to search an index, pass the index from the table's `indexes` instead.
 */
export class FullTextDocument {
  readonly weightGroups: FullTextWeightGroups<FullTextDocumentColumn>;

  private constructor(weightGroups: FullTextWeightGroups<FullTextDocumentColumn>) {
    this.weightGroups = weightGroups;
    Object.freeze(this);
  }

  static of(groups: FullTextDocumentGroups): FullTextDocument {
    const weightGroups = weightGroupsOf(
      groups,
      (item): item is FullTextDocumentColumn => !Array.isArray(item),
    );
    let position = 0;
    const [problem] = fullTextIndexProblems({
      weightGroups: weightGroups.map((group) => group.map(() => String(position++))),
    });
    if (problem !== undefined) {
      throw postgresError(
        'RUNTIME.ARGUMENT_INVALID',
        describeFullTextIndexProblem('fullTextDocument: the document', problem),
        {
          why: `Each weight group takes one of the weights Postgres has, ${FULL_TEXT_WEIGHTS.join(', ')}.`,
          fix: 'Pass one to four weight groups, none of them empty.',
          meta: { helper: 'fullTextDocument', argument: 'groups', received: weightGroups.length },
        },
      );
    }
    return new FullTextDocument(weightGroups);
  }
}

/**
 * The search document of columns in weight groups, strongest first: `fullTextDocument([[f.title,
 * f.subtitle], [f.body]])`. Each group takes the next weight, `A` to `D`; a column named twice is
 * not refused, because column expressions have no name to compare.
 */
export function fullTextDocument(groups: FullTextDocumentGroups): FullTextDocument {
  return FullTextDocument.of(groups);
}
