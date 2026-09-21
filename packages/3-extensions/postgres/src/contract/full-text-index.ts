import type { ColumnRef, IndexConstraint } from '@internal/sql-contract-ts/contract-builder';
import type { FullTextSearchLanguage } from '@internal/target-postgres/operation-types';
import { renderFullTextIndexExpression } from '@internal/target-postgres/sql-utils';

type FullTextIndexOptions = { readonly language?: FullTextSearchLanguage } & (
  | { readonly name: string; readonly map?: never }
  | { readonly map: string; readonly name?: never }
);

const DEFAULT_LANGUAGE: FullTextSearchLanguage = 'english';

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
  const language = options.language ?? DEFAULT_LANGUAGE;
  return {
    kind: 'index',
    expression: {
      fields: [column],
      render: (columnNames: readonly string[]) =>
        renderFullTextIndexExpression(language, columnNames[0] ?? ''),
    },
    type: 'gin',
    ...(options.name !== undefined ? { name: options.name } : {}),
    ...(options.map !== undefined ? { map: options.map } : {}),
  };
}
