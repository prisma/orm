import type { AnyExpression } from '@internal/sql-relational-core/ast';
import { buildOperation, toExpr } from '@internal/sql-relational-core/expression';
import { assertDefined } from '@internal/utils/assertions';
import type { QueryOperationTypes } from '../types/operation-types';
import {
  PG_BOOL_CODEC_ID,
  PG_FLOAT4_CODEC_ID,
  PG_TEXT_CODEC_ID,
  PG_TSQUERY_CODEC_ID,
} from './codec-ids';
import { postgresError } from './errors';
import { renderFullTextDocument, weightGroupsOf } from './full-text-index-expression';
import {
  type FullTextHeadlineOptions,
  type FullTextMatchesOptions,
  type FullTextRankOptions,
  headlineOptionsLiteral,
  languageLiteral,
  normalizationLiteral,
} from './full-text-options';
import {
  phrasetoTsquery,
  plaintoTsquery,
  toTsquery,
  websearchToTsquery,
} from './full-text-parsers';
import { FULL_TEXT_WEIGHTS } from './index-types';
import { DEFAULT_FULL_TEXT_SEARCH_LANGUAGE } from './text-search-languages';

type CodecTypesBase = Record<string, { readonly input: unknown; readonly output: unknown }>;

const TEXT_REF = { codecId: PG_TEXT_CODEC_ID } as const;
const TSQUERY_REF = { codecId: PG_TSQUERY_CODEC_ID } as const;

const languageOf = (options: FullTextMatchesOptions) =>
  options.language ?? DEFAULT_FULL_TEXT_SEARCH_LANGUAGE;

/**
 * The search document an operation searches: one column, or weight groups of columns. The first
 * column is the operation's `self`; the others follow the `fixedArgs` the operation passes first,
 * so the query, the language and any further option keep their positions.
 */
function searchDocument(method: string, document: unknown, fixedArgs: number) {
  const groups = Array.isArray(document)
    ? weightGroupsOf(document, (item): item is unknown => !Array.isArray(item))
    : [[document]];
  if (
    groups.length === 0 ||
    groups.length > FULL_TEXT_WEIGHTS.length ||
    groups.some((group) => group.length === 0)
  ) {
    throw postgresError(
      'RUNTIME.ARGUMENT_INVALID',
      `${method}: the document takes 1 to ${FULL_TEXT_WEIGHTS.length} weight groups, none of them empty.`,
      {
        why: 'Each weight group takes one of the weights Postgres has, A to D.',
        fix: 'Pass the same weight groups as the full-text index the query should use.',
        meta: { helper: method, argument: 'document', received: groups.length },
      },
    );
  }
  const columns = groups.flat();
  let position = 0;
  const positions = groups.map((group) => group.map(() => position++));
  const template = renderFullTextDocument(positions, {
    column: (index) => (index === 0 ? '{{self}}' : `{{arg${fixedArgs + index - 1}}}`),
    language: '{{arg1}}',
  });
  const [self, ...rest] = columns.map((column): AnyExpression => toExpr(column));
  assertDefined(self, `${method}: a checked document has a first column`);
  return { self, rest, template };
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
          lowering: { targetFamily: 'sql', template: '{{self}} ILIKE {{arg0}}' },
        }),
    },
    fullTextMatches: {
      self: { traits: ['textual'] },
      impl: (self, query, options: FullTextMatchesOptions = {}) => {
        const language = languageLiteral('fullTextMatches', languageOf(options));
        const document = searchDocument('fullTextMatches', self, 2);
        return buildOperation({
          method: 'fullTextMatches',
          args: [document.self, toExpr(query, TSQUERY_REF), language, ...document.rest],
          returns: { codecId: PG_BOOL_CODEC_ID, nullable: false },
          lowering: { targetFamily: 'sql', template: `${document.template} @@ {{arg0}}` },
        });
      },
    },
    fullTextRank: {
      self: { traits: ['textual'] },
      impl: (self, query, options: FullTextRankOptions = {}) => {
        const fn = options.coverDensity === true ? 'ts_rank_cd' : 'ts_rank';
        const language = languageLiteral('fullTextRank', languageOf(options));
        const normalization =
          options.normalization === undefined
            ? undefined
            : normalizationLiteral('fullTextRank', options.normalization);
        const fixed = normalization === undefined ? [language] : [language, normalization];
        const document = searchDocument('fullTextRank', self, fixed.length + 1);
        return buildOperation({
          method: 'fullTextRank',
          args: [document.self, toExpr(query, TSQUERY_REF), ...fixed, ...document.rest],
          returns: { codecId: PG_FLOAT4_CODEC_ID, nullable: false },
          lowering: {
            targetFamily: 'sql',
            template: `${fn}(${document.template}, {{arg0}}${normalization === undefined ? '' : ', {{arg2}}'})`,
          },
        });
      },
    },
    fullTextHeadline: {
      self: { traits: ['textual'] },
      impl: (self, query, options: FullTextHeadlineOptions = {}) => {
        const headlineOptions = headlineOptionsLiteral('fullTextHeadline', options);
        const base = 'ts_headline({{arg1}}, {{self}}, {{arg0}}';
        return buildOperation({
          method: 'fullTextHeadline',
          args: [
            toExpr(self),
            toExpr(query, TSQUERY_REF),
            languageLiteral('fullTextHeadline', languageOf(options)),
            ...(headlineOptions === undefined ? [] : [headlineOptions]),
          ],
          returns: { codecId: PG_TEXT_CODEC_ID, nullable: false },
          lowering: {
            targetFamily: 'sql',
            template: `${base}${headlineOptions === undefined ? '' : ', {{arg2}}'})`,
          },
        });
      },
    },
    websearchToTsquery: { impl: websearchToTsquery },
    toTsquery: { impl: toTsquery },
    plaintoTsquery: { impl: plaintoTsquery },
    phrasetoTsquery: { impl: phrasetoTsquery },
  };
}
