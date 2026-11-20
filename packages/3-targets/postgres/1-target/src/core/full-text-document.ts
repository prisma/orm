import { isExpression, type TraitExpression } from '@internal/sql-relational-core/expression';
import { blindCast } from '@internal/utils/casts';
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

type NullableOf<Column> = Column extends {
  readonly returnType: { readonly nullable: infer Nullable extends boolean };
}
  ? Nullable
  : false;

/**
 * Whether the search document of these weight groups can be null. A document of one column is null
 * where that column is; with more columns each is wrapped in `coalesce`, so it never is.
 */
export type FullTextDocumentNullable<Groups extends FullTextDocumentGroups> =
  number extends Groups['length']
    ? boolean
    : Groups extends readonly [infer Only]
      ? Only extends readonly unknown[]
        ? number extends Only['length']
          ? boolean
          : Only extends readonly [infer Column]
            ? NullableOf<Column>
            : false
        : NullableOf<Only>
      : false;

/** Whether a search document of these weight groups can be null: see {@link FullTextDocumentNullable}. */
export function documentIsNullable(weightGroups: FullTextWeightGroups<unknown>): boolean {
  const columns = weightGroups.flat();
  const [only] = columns;
  return columns.length === 1 && isExpression(only) && only.returnType.nullable;
}

/**
 * A search document built from columns in weight groups, for `fullTextMatches` and `fullTextRank`
 * to search without a full-text index. Postgres uses an index only for a query over the same
 * document, so to search an index, pass the index from the table's `indexes` instead.
 */
export class FullTextDocument<Nullable extends boolean = boolean> {
  readonly weightGroups: FullTextWeightGroups<FullTextDocumentColumn>;
  /** Whether the document can be null, so that a search over it can be too. */
  readonly nullable: Nullable;

  private constructor(weightGroups: FullTextWeightGroups<FullTextDocumentColumn>) {
    this.weightGroups = weightGroups;
    this.nullable = blindCast<Nullable, 'fullTextDocument types the nullability it computes here'>(
      documentIsNullable(weightGroups),
    );
    Object.freeze(this);
  }

  static of<const Groups extends FullTextDocumentGroups>(
    groups: Groups,
  ): FullTextDocument<FullTextDocumentNullable<Groups>> {
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
    return new FullTextDocument<FullTextDocumentNullable<Groups>>(weightGroups);
  }
}

/**
 * The search document of columns in weight groups, strongest first: `fullTextDocument([[f.title,
 * f.subtitle], [f.body]])`. Each group takes the next weight, `A` to `D`; a column named twice is
 * not refused, because column expressions have no name to compare.
 */
export function fullTextDocument<const Groups extends FullTextDocumentGroups>(
  groups: Groups,
): FullTextDocument<FullTextDocumentNullable<Groups>> {
  return FullTextDocument.of(groups);
}
