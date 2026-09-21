import { quoteIdentifier } from './sql-utils';
import type { FullTextSearchLanguage } from './text-search-languages';

/**
 * The index expression that covers `fullTextMatches`, `fullTextRank` and
 * `fullTextHeadline` on a column. Postgres only uses an expression index when
 * the indexed expression matches the query's byte for byte, so both the
 * `@@fullTextIndex` attribute and the TypeScript helper render it here rather
 * than each spelling it out.
 */
export function renderFullTextIndexExpression(
  language: FullTextSearchLanguage,
  columnName: string,
): string {
  return `to_tsvector('${language}', ${quoteIdentifier(columnName)})`;
}
