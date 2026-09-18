import { LiteralExpr } from '@internal/sql-relational-core/ast';
import { buildOperation, toExpr } from '@internal/sql-relational-core/expression';
import type { QueryOperationTypes } from '../types/operation-types';
import { PG_BOOL_CODEC_ID, PG_FLOAT4_CODEC_ID, PG_TEXT_CODEC_ID } from './codec-ids';
import { postgresError } from './errors';
import {
  DEFAULT_FULL_TEXT_SEARCH_LANGUAGE,
  isFullTextSearchLanguage,
  POSTGRES_TEXT_SEARCH_LANGUAGES,
} from './text-search-languages';

type CodecTypesBase = Record<string, { readonly input: unknown; readonly output: unknown }>;

const TEXT_REF = { codecId: PG_TEXT_CODEC_ID } as const;

function languageLiteral(method: string, language: string): LiteralExpr {
  if (!isFullTextSearchLanguage(language)) {
    throw postgresError(
      'RUNTIME.ARGUMENT_INVALID',
      `${method}: '${language}' is not a PostgreSQL text-search configuration Prisma recognizes.`,
      {
        why: 'The language is written into the SQL as an inline literal, not a bound parameter, so it is checked against the configurations a stock PostgreSQL server ships with.',
        fix: `Pass one of: ${POSTGRES_TEXT_SEARCH_LANGUAGES.join(', ')}.`,
        meta: { helper: method, argument: 'language', received: language },
      },
    );
  }
  return LiteralExpr.of(language);
}

export function postgresQueryOperations<CT extends CodecTypesBase>(): QueryOperationTypes<CT> {
  return {
    ilike: {
      self: { traits: ['textual'] },
      impl: (self, pattern) =>
        buildOperation({
          method: 'ilike',
          args: [toExpr(self), toExpr(pattern, TEXT_REF)],
          returns: { codecId: PG_BOOL_CODEC_ID, nullable: false },
          lowering: { targetFamily: 'sql', strategy: 'infix', template: '{{self}} ILIKE {{arg0}}' },
        }),
    },
    fullTextMatches: {
      self: { traits: ['textual'] },
      impl: (self, query, language = DEFAULT_FULL_TEXT_SEARCH_LANGUAGE) =>
        buildOperation({
          method: 'fullTextMatches',
          args: [
            toExpr(self),
            toExpr(query, TEXT_REF),
            languageLiteral('fullTextMatches', language),
          ],
          returns: { codecId: PG_BOOL_CODEC_ID, nullable: false },
          lowering: {
            targetFamily: 'sql',
            strategy: 'function',
            template: 'to_tsvector({{arg1}}, {{self}}) @@ websearch_to_tsquery({{arg1}}, {{arg0}})',
          },
        }),
    },
    fullTextRank: {
      self: { traits: ['textual'] },
      impl: (self, query, language = DEFAULT_FULL_TEXT_SEARCH_LANGUAGE) =>
        buildOperation({
          method: 'fullTextRank',
          args: [toExpr(self), toExpr(query, TEXT_REF), languageLiteral('fullTextRank', language)],
          returns: { codecId: PG_FLOAT4_CODEC_ID, nullable: false },
          lowering: {
            targetFamily: 'sql',
            strategy: 'function',
            template:
              'ts_rank(to_tsvector({{arg1}}, {{self}}), websearch_to_tsquery({{arg1}}, {{arg0}}))',
          },
        }),
    },
    fullTextHeadline: {
      self: { traits: ['textual'] },
      impl: (self, query, language = DEFAULT_FULL_TEXT_SEARCH_LANGUAGE) =>
        buildOperation({
          method: 'fullTextHeadline',
          args: [
            toExpr(self),
            toExpr(query, TEXT_REF),
            languageLiteral('fullTextHeadline', language),
          ],
          returns: { codecId: PG_TEXT_CODEC_ID, nullable: false },
          lowering: {
            targetFamily: 'sql',
            strategy: 'function',
            template: 'ts_headline({{arg1}}, {{self}}, websearch_to_tsquery({{arg1}}, {{arg0}}))',
          },
        }),
    },
  };
}
