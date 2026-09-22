import { codecDescriptors } from './codecs';
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

/** Widens a descriptor's trait tuple, so membership is a plain string test. */
function traitsOf(descriptor: { readonly traits: readonly string[] }): readonly string[] {
  return descriptor.traits;
}

const TEXTUAL_CODEC_IDS: ReadonlySet<string> = new Set(
  codecDescriptors
    .filter((descriptor) => traitsOf(descriptor).includes('textual'))
    .map((descriptor) => descriptor.codecId),
);

/**
 * Whether a column stored through this codec can be indexed for full-text search.
 * Read from the codec descriptors themselves, so both authoring surfaces accept
 * exactly the columns the `textual` operations dispatch on.
 */
export function isFullTextIndexableCodec(codecId: string): boolean {
  return TEXTUAL_CODEC_IDS.has(codecId);
}
