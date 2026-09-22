import { buildOperation, toExpr } from '@internal/sql-relational-core/expression';
import type { QueryOperationTypes } from '../types/operation-types';
import { PG_BOOL_CODEC_ID, PG_FLOAT4_CODEC_ID, PG_TEXT_CODEC_ID } from './codec-ids';
import {
  type FullTextHeadlineOptions,
  type FullTextMatchesOptions,
  type FullTextRankOptions,
  headlineOptionsLiteral,
  languageLiteral,
  normalizationLiteral,
} from './full-text-options';
import { DEFAULT_FULL_TEXT_SEARCH_LANGUAGE } from './text-search-languages';

type CodecTypesBase = Record<string, { readonly input: unknown; readonly output: unknown }>;

const TEXT_REF = { codecId: PG_TEXT_CODEC_ID } as const;

const languageOf = (options: FullTextMatchesOptions) =>
  options.language ?? DEFAULT_FULL_TEXT_SEARCH_LANGUAGE;

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
      impl: (self, query, options: FullTextMatchesOptions = {}) =>
        buildOperation({
          method: 'fullTextMatches',
          args: [
            toExpr(self),
            toExpr(query, TEXT_REF),
            languageLiteral('fullTextMatches', languageOf(options)),
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
      impl: (self, query, options: FullTextRankOptions = {}) => {
        const fn = options.coverDensity === true ? 'ts_rank_cd' : 'ts_rank';
        const normalization =
          options.normalization === undefined
            ? undefined
            : normalizationLiteral('fullTextRank', options.normalization);
        const vectorAndQuery =
          'to_tsvector({{arg1}}, {{self}}), websearch_to_tsquery({{arg1}}, {{arg0}})';
        return buildOperation({
          method: 'fullTextRank',
          args: [
            toExpr(self),
            toExpr(query, TEXT_REF),
            languageLiteral('fullTextRank', languageOf(options)),
            ...(normalization === undefined ? [] : [normalization]),
          ],
          returns: { codecId: PG_FLOAT4_CODEC_ID, nullable: false },
          lowering: {
            targetFamily: 'sql',
            strategy: 'function',
            template: `${fn}(${vectorAndQuery}${normalization === undefined ? '' : ', {{arg2}}'})`,
          },
        });
      },
    },
    fullTextHeadline: {
      self: { traits: ['textual'] },
      impl: (self, query, options: FullTextHeadlineOptions = {}) => {
        const headlineOptions = headlineOptionsLiteral('fullTextHeadline', options);
        const base = 'ts_headline({{arg1}}, {{self}}, websearch_to_tsquery({{arg1}}, {{arg0}})';
        return buildOperation({
          method: 'fullTextHeadline',
          args: [
            toExpr(self),
            toExpr(query, TEXT_REF),
            languageLiteral('fullTextHeadline', languageOf(options)),
            ...(headlineOptions === undefined ? [] : [headlineOptions]),
          ],
          returns: { codecId: PG_TEXT_CODEC_ID, nullable: false },
          lowering: {
            targetFamily: 'sql',
            strategy: 'function',
            template: `${base}${headlineOptions === undefined ? '' : ', {{arg2}}'})`,
          },
        });
      },
    },
  };
}
