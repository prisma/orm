import { blindCast } from '@internal/utils/casts';

/** Text in Postgres `tsquery` syntax, marked as such by {@link rawTsquery}. */
export type RawTsquery = string & { readonly __rawTsquery: true };

/**
 * Marks text as Postgres `tsquery` syntax, so a full-text operation binds it as a `tsquery`
 * parameter. Postgres applies no text-search configuration to it: the words are neither lowercased
 * nor stemmed, and malformed syntax fails at execution. Pass only text the application wrote, never
 * user input: `websearchToTsquery` parses search-box text, and `tsquery` interpolates user input
 * into operator syntax safely.
 */
export function rawTsquery(text: string): RawTsquery {
  return blindCast<
    RawTsquery,
    'the brand exists only in the type; the text is already the tsquery'
  >(text);
}
