import {
  buildOperation,
  type Expression,
  type TraitExpression,
  toExpr,
} from '@internal/sql-relational-core/expression';
import { PG_TEXT_CODEC_ID, PG_TSQUERY_CODEC_ID } from './codec-ids';
import type { ExtractedCodecTypes } from './codec-type-map';
import { languageLiteral } from './full-text-options';
import {
  DEFAULT_FULL_TEXT_SEARCH_LANGUAGE,
  type FullTextSearchLanguage,
} from './text-search-languages';

export interface TsqueryParserOptions {
  /** Text-search configuration the parser normalizes the words with. Defaults to `english`. */
  readonly language?: FullTextSearchLanguage;
}

export type TsqueryExpression = Expression<{
  codecId: typeof PG_TSQUERY_CODEC_ID;
  nullable: false;
}>;

/**
 * What a parser parses: a string, bound as `text`, or a non-null expression whose codec is one of
 * this target's `textual` codecs, such as a `text` or `varchar` column.
 */
export type TextArgument = TraitExpression<readonly ['textual'], false, ExtractedCodecTypes>;

const TEXT_REF = { codecId: PG_TEXT_CODEC_ID } as const;

function parser(method: string, fn: string) {
  return (text: TextArgument, options: TsqueryParserOptions = {}): TsqueryExpression =>
    buildOperation({
      method,
      args: [
        toExpr(text, TEXT_REF),
        languageLiteral(method, options.language ?? DEFAULT_FULL_TEXT_SEARCH_LANGUAGE),
      ],
      returns: { codecId: PG_TSQUERY_CODEC_ID, nullable: false },
      lowering: { targetFamily: 'sql', template: `${fn}({{arg0}}, {{self}})` },
    });
}

/** Postgres `websearch_to_tsquery`: search-box syntax with quotes, `or` and `-`. Never errors. */
export const websearchToTsquery = parser('websearchToTsquery', 'websearch_to_tsquery');

/**
 * Postgres `to_tsquery`: operator syntax (`'zebra' & !'graze'`, `zeb:*`), each word normalized.
 * Malformed input fails at execution, so pass only text the application wrote, never user input;
 * `tsquery` interpolates user input safely.
 */
export const toTsquery = parser('toTsquery', 'to_tsquery');

/** Postgres `plainto_tsquery`: every word must match. */
export const plaintoTsquery = parser('plaintoTsquery', 'plainto_tsquery');

/** Postgres `phraseto_tsquery`: the words must match in order. */
export const phrasetoTsquery = parser('phrasetoTsquery', 'phraseto_tsquery');
