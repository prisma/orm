import type { ColumnRef, IndexConstraint } from '@internal/sql-contract-ts/contract-builder';
import type { FullTextSearchLanguage } from '@internal/target-postgres/operation-types';
import {
  DEFAULT_FULL_TEXT_SEARCH_LANGUAGE,
  renderFullTextIndexExpression,
} from '@internal/target-postgres/sql-utils';
import { invariant } from '@internal/utils/assertions';

type FullTextIndexOptions = {
  readonly language?: FullTextSearchLanguage;
  /** The SQL predicate restricting rows included in a partial index. */
  readonly where?: string;
} & (
  | { readonly name: string; readonly map?: never }
  | { readonly map: string; readonly name?: never }
);

/**
 * A GIN index over the `to_tsvector` expression `fullTextMatches`,
 * `fullTextRank` and `fullTextHeadline` lower to — the TypeScript twin of
 * `@@fullTextIndex`. Pass it to a model's `sql({ indexes: [...] })`.
 *
 * The expression is rendered at lowering, once the column's storage name is
 * known, so a `.column()` override or a column naming convention is honoured
 * and the index cannot stop matching the predicate.
 */
export function fullTextIndex(
  column: ColumnRef,
  options: FullTextIndexOptions,
): IndexConstraint<never, string> {
  const language = options.language ?? DEFAULT_FULL_TEXT_SEARCH_LANGUAGE;
  return {
    kind: 'index',
    expression: {
      fields: [column],
      render: (columnNames: readonly string[]) => {
        const columnName = columnNames[0];
        // Lowering resolves one name per field it was given, or raises
        // `CONTRACT.FIELD_UNKNOWN`; this helper hands it exactly one.
        invariant(
          columnName !== undefined,
          `fullTextIndex resolved no column name for field "${column.fieldName}"`,
        );
        return renderFullTextIndexExpression(language, columnName);
      },
    },
    type: 'gin',
    ...(options.where !== undefined ? { where: options.where } : {}),
    ...(options.name !== undefined ? { name: options.name } : {}),
    ...(options.map !== undefined ? { map: options.map } : {}),
  };
}
