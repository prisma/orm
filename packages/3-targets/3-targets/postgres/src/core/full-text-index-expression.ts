import { quoteIdentifier } from './sql-utils';
import type { FullTextSearchLanguage } from './text-search-languages';

/**
 * The index expression that covers `fullTextMatches`, `fullTextRank` and
 * `fullTextHeadline` on a column. Postgres uses an expression index only when the
 * indexed expression is the same `to_tsvector` over the same configuration literal and
 * the same column as the query, so both the `@@fullTextIndex` attribute and the
 * TypeScript helper render it here rather than each spelling it out.
 */
export function renderFullTextIndexExpression(
  language: FullTextSearchLanguage,
  columnName: string,
): string {
  return `to_tsvector('${language}', ${quoteIdentifier(columnName)})`;
}
