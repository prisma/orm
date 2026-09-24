/**
 * The text-search configurations a stock PostgreSQL server ships with. The language reaches SQL as
 * an inline literal rather than a bound parameter, so only names on this list may be used.
 */
export const POSTGRES_TEXT_SEARCH_LANGUAGES = [
  'simple',
  'arabic',
  'armenian',
  'basque',
  'catalan',
  'danish',
  'dutch',
  'english',
  'finnish',
  'french',
  'german',
  'greek',
  'hindi',
  'hungarian',
  'indonesian',
  'irish',
  'italian',
  'lithuanian',
  'nepali',
  'norwegian',
  'portuguese',
  'romanian',
  'russian',
  'serbian',
  'spanish',
  'swedish',
  'tamil',
  'turkish',
  'yiddish',
] as const;

export type FullTextSearchLanguage = (typeof POSTGRES_TEXT_SEARCH_LANGUAGES)[number];

export const DEFAULT_FULL_TEXT_SEARCH_LANGUAGE: FullTextSearchLanguage = 'english';

const KNOWN_LANGUAGES: ReadonlySet<string> = new Set(POSTGRES_TEXT_SEARCH_LANGUAGES);

export function isFullTextSearchLanguage(language: string): language is FullTextSearchLanguage {
  return KNOWN_LANGUAGES.has(language);
}
