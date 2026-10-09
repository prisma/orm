import type { AnyExpression } from '@internal/sql-relational-core/ast';
import { buildOperation, isExpression, toExpr } from '@internal/sql-relational-core/expression';
import { assertDefined } from '@internal/utils/assertions';
import { type } from 'arktype';
import type { QueryOperationTypes } from '../types/operation-types';
import {
  PG_BOOL_CODEC_ID,
  PG_FLOAT4_CODEC_ID,
  PG_TEXT_CODEC_ID,
  PG_TSQUERY_CODEC_ID,
} from './codec-ids';
import { postgresError } from './errors';
import { FullTextDocument } from './full-text-document';
import { FULL_TEXT_INDEX_TYPE, fullTextIndexOptions } from './full-text-index-definition';
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
import { renderFullTextDocument } from './full-text-search-document';
import type { FullTextWeightGroups } from './full-text-weight-groups';
import { DEFAULT_FULL_TEXT_SEARCH_LANGUAGE } from './text-search-languages';

type CodecTypesBase = Record<string, { readonly input: unknown; readonly output: unknown }>;

const TEXT_REF = { codecId: PG_TEXT_CODEC_ID } as const;
const TSQUERY_REF = { codecId: PG_TSQUERY_CODEC_ID } as const;

const languageOf = (options: FullTextMatchesOptions) =>
  options.language ?? DEFAULT_FULL_TEXT_SEARCH_LANGUAGE;

/** A table's index as the SQL builder's `table.indexes` gives it: its columns by name, its type and its options. */
interface IndexReferenceValue {
  readonly type: unknown;
  readonly options: unknown;
  readonly columns: unknown;
}

function isIndexReference(value: unknown): value is IndexReferenceValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !isExpression(value) &&
    'type' in value &&
    'options' in value &&
    'columns' in value
  );
}

function invalidDocument(
  method: string,
  argument: string,
  received: unknown,
  message: string,
  fix: string,
) {
  return postgresError('RUNTIME.ARGUMENT_INVALID', `${method}: ${message}`, {
    why: 'Postgres uses a full-text index only for a query over the same search document, so the document comes from the index itself, from one column, or from `fullTextDocument`.',
    fix,
    meta: { helper: method, argument, received },
  });
}

/**
 * The weight groups and the language a search document stands for. A full-text index states both;
 * a column and a `fullTextDocument` take the language from the options.
 */
function documentGroups(
  method: string,
  document: unknown,
  options: FullTextMatchesOptions,
): { readonly weightGroups: FullTextWeightGroups<unknown>; readonly language: string } {
  if (document instanceof FullTextDocument) {
    return { weightGroups: document.weightGroups, language: languageOf(options) };
  }
  if (isExpression(document)) return { weightGroups: [[document]], language: languageOf(options) };
  if (!isIndexReference(document)) {
    throw invalidDocument(
      method,
      'document',
      Array.isArray(document) ? 'array' : typeof document,
      "the document must be a full-text index from a table's `indexes`, a column, or a document from `fullTextDocument`.",
      'Pass the index, as `table.indexes.<name>`, or wrap the weight groups in `fullTextDocument(...)`.',
    );
  }
  if (document.type !== FULL_TEXT_INDEX_TYPE) {
    throw invalidDocument(
      method,
      'document',
      document.type,
      `the index is of type "${String(document.type)}", not a full-text index.`,
      'Pass an index declared with `@@fullTextIndex` or `fullTextIndex`.',
    );
  }
  if (options.language !== undefined) {
    throw invalidDocument(
      method,
      'options',
      options.language,
      'a full-text index states its language, so the `language` option is not taken with one.',
      'Leave `language` out; the index decides it.',
    );
  }
  const definition = fullTextIndexOptions(document.options ?? {});
  if (definition instanceof type.errors) {
    throw invalidDocument(
      method,
      'document',
      document.options,
      `the full-text index has invalid options: ${definition.summary}`,
      'Pass the index as the table gives it.',
    );
  }
  const columns = document.columns;
  const columnOf = (name: string): unknown => {
    const column: unknown =
      typeof columns === 'object' && columns !== null && Object.hasOwn(columns, name)
        ? Reflect.get(columns, name)
        : undefined;
    if (!isExpression(column)) {
      throw invalidDocument(
        method,
        'document',
        name,
        `the full-text index has no column "${name}", which its weight groups name.`,
        'Pass the index as the table gives it.',
      );
    }
    return column;
  };
  return {
    weightGroups: definition.weightGroups.map((group) => group.map(columnOf)),
    language: definition.language,
  };
}

/**
 * The search document an operation searches. The first column is the operation's `self`; the
 * others follow the `fixedArgs` the operation passes first, so the query, the language and any
 * further option keep their positions.
 */
function searchDocument(
  method: string,
  document: unknown,
  options: FullTextMatchesOptions,
  fixedArgs: number,
) {
  const { weightGroups, language } = documentGroups(method, document, options);
  let position = 0;
  const positions = weightGroups.map((group) => group.map(() => position++));
  const template = renderFullTextDocument(positions, {
    column: (index) => (index === 0 ? '{{self}}' : `{{arg${fixedArgs + index - 1}}}`),
    language: '{{arg1}}',
  });
  const [self, ...rest] = weightGroups.flat().map((column): AnyExpression => toExpr(column));
  assertDefined(self, `${method}: a checked document has a first column`);
  return { self, rest, template, language: languageLiteral(method, language) };
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
      impl: (document: unknown, query: unknown, options: FullTextMatchesOptions = {}) => {
        const searched = searchDocument('fullTextMatches', document, options, 2);
        return buildOperation({
          method: 'fullTextMatches',
          args: [searched.self, toExpr(query, TSQUERY_REF), searched.language, ...searched.rest],
          returns: { codecId: PG_BOOL_CODEC_ID, nullable: false },
          lowering: { targetFamily: 'sql', template: `${searched.template} @@ {{arg0}}` },
        });
      },
    },
    fullTextRank: {
      self: { traits: ['textual'] },
      impl: (document: unknown, query: unknown, options: FullTextRankOptions = {}) => {
        const fn = options.coverDensity === true ? 'ts_rank_cd' : 'ts_rank';
        const normalization =
          options.normalization === undefined
            ? undefined
            : normalizationLiteral('fullTextRank', options.normalization);
        const searched = searchDocument(
          'fullTextRank',
          document,
          options,
          normalization === undefined ? 2 : 3,
        );
        const fixed =
          normalization === undefined ? [searched.language] : [searched.language, normalization];
        return buildOperation({
          method: 'fullTextRank',
          args: [searched.self, toExpr(query, TSQUERY_REF), ...fixed, ...searched.rest],
          returns: { codecId: PG_FLOAT4_CODEC_ID, nullable: false },
          lowering: {
            targetFamily: 'sql',
            template: `${fn}(${searched.template}, {{arg0}}${normalization === undefined ? '' : ', {{arg2}}'})`,
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
