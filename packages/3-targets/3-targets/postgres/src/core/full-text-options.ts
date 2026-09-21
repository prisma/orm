import { LiteralExpr } from '@internal/sql-relational-core/ast';
import { postgresError } from './errors';
import {
  type FullTextSearchLanguage,
  isFullTextSearchLanguage,
  POSTGRES_TEXT_SEARCH_LANGUAGES,
} from './text-search-languages';

/**
 * Every option below reaches the SQL as an inline literal rather than a bound
 * parameter, because Postgres accepts no parameter in these positions. Each is
 * therefore checked here first; anything unrecognized throws
 * `RUNTIME.ARGUMENT_INVALID` before a statement exists.
 */

export interface FullTextMatchesOptions {
  /** Text-search configuration. Defaults to `english`. */
  readonly language?: FullTextSearchLanguage;
}

export interface FullTextRankOptions extends FullTextMatchesOptions {
  /** `ts_rank` normalization bitmask, 0 to 63; see the PostgreSQL manual. */
  readonly normalization?: number;
  /** Rank by cover density (`ts_rank_cd`) instead of `ts_rank`. */
  readonly coverDensity?: boolean;
}

export interface FullTextHeadlineOptions extends FullTextMatchesOptions {
  /** Markup placed before each match. */
  readonly startSel?: string;
  /** Markup placed after each match. */
  readonly stopSel?: string;
  /** Longest headline, in words. */
  readonly maxWords?: number;
  /** Shortest headline, in words; at most `maxWords` when both are given. */
  readonly minWords?: number;
  /** Mark up the whole document rather than extracting fragments. */
  readonly highlightAll?: boolean;
}

function invalid(method: string, argument: string, received: unknown, why: string, fix: string) {
  return postgresError('RUNTIME.ARGUMENT_INVALID', `${method}: ${why}`, {
    why: 'The option is written into the SQL as an inline literal, not a bound parameter, so it is checked before the statement is built.',
    fix,
    meta: { helper: method, argument, received },
  });
}

export function languageLiteral(method: string, language: string): LiteralExpr {
  if (!isFullTextSearchLanguage(language)) {
    throw invalid(
      method,
      'language',
      language,
      `'${language}' is not a PostgreSQL text-search configuration Prisma recognizes.`,
      `Pass one of: ${POSTGRES_TEXT_SEARCH_LANGUAGES.join(', ')}.`,
    );
  }
  return LiteralExpr.of(language);
}

export function normalizationLiteral(method: string, normalization: number): LiteralExpr {
  if (!Number.isInteger(normalization) || normalization < 0 || normalization > 63) {
    throw invalid(
      method,
      'normalization',
      normalization,
      `normalization must be an integer between 0 and 63, received ${normalization}.`,
      'Combine the flags documented for ts_rank, e.g. 32 to divide the rank by itself plus one.',
    );
  }
  return LiteralExpr.of(normalization);
}

function checkWordCount(method: string, argument: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw invalid(
      method,
      argument,
      value,
      `${argument} must be a positive integer, received ${value}.`,
      'Pass a whole number of words, one or more.',
    );
  }
}

function checkMarker(method: string, argument: string, value: string): void {
  if (value.length === 0 || /["=,]/.test(value)) {
    throw invalid(
      method,
      argument,
      value,
      `${argument} must be non-empty and free of " , and =, received ${JSON.stringify(value)}.`,
      'ts_headline parses its options as a quoted, comma-separated list of Key=Value pairs, so a marker carrying those characters cannot survive it. Use markup such as <mark> or <b>.',
    );
  }
}

/**
 * The fourth `ts_headline` argument: one text literal of `Key=Value` pairs.
 * Returns `undefined` when nothing but the language was given, so the common
 * call keeps rendering the three-argument form.
 */
export function headlineOptionsLiteral(
  method: string,
  options: FullTextHeadlineOptions,
): LiteralExpr | undefined {
  const pairs: string[] = [];
  if (options.startSel !== undefined) {
    checkMarker(method, 'startSel', options.startSel);
    pairs.push(`StartSel=${options.startSel}`);
  }
  if (options.stopSel !== undefined) {
    checkMarker(method, 'stopSel', options.stopSel);
    pairs.push(`StopSel=${options.stopSel}`);
  }
  if (options.maxWords !== undefined) {
    checkWordCount(method, 'maxWords', options.maxWords);
    pairs.push(`MaxWords=${options.maxWords}`);
  }
  if (options.minWords !== undefined) {
    checkWordCount(method, 'minWords', options.minWords);
    if (options.maxWords !== undefined && options.minWords > options.maxWords) {
      throw invalid(
        method,
        'minWords',
        options.minWords,
        `minWords (${options.minWords}) cannot exceed maxWords (${options.maxWords}).`,
        'Lower minWords, or raise maxWords.',
      );
    }
    pairs.push(`MinWords=${options.minWords}`);
  }
  if (options.highlightAll !== undefined) {
    pairs.push(`HighlightAll=${options.highlightAll}`);
  }
  return pairs.length === 0 ? undefined : LiteralExpr.of(pairs.join(', '));
}
