import type { SqlQueryOperationTypes } from '@internal/sql-contract/types';
import type {
  CodecExpression,
  Expression,
  TraitExpression,
} from '@internal/sql-relational-core/expression';
import type {
  FullTextHeadlineOptions,
  FullTextMatchesOptions,
  FullTextRankOptions,
} from '../core/full-text-options';
import type { TextInput, TsqueryParserOptions } from '../core/full-text-parsers';

type CodecTypesBase = Record<string, { readonly input: unknown; readonly output: unknown }>;

type TextualSelfSpec = { readonly traits: readonly ['textual'] };

type TextualSelf<CT extends CodecTypesBase> = TraitExpression<readonly ['textual'], false, CT>;

type TextArgument<CT extends CodecTypesBase> = CodecExpression<'pg/text@1', false, CT>;

/**
 * The query side of a full-text operation: a `tsquery` expression from one of the parsers in
 * `full-text`, or a raw string in Postgres `tsquery` syntax, bound as a `tsquery` parameter.
 */
export type TsqueryArgument<CT extends CodecTypesBase> = CodecExpression<'pg/tsquery@1', false, CT>;

type TsqueryParser = {
  readonly impl: (
    text: TextInput,
    options?: TsqueryParserOptions,
  ) => Expression<{ codecId: 'pg/tsquery@1'; nullable: false }>;
};

export type QueryOperationTypes<CT extends CodecTypesBase> = SqlQueryOperationTypes<
  CT,
  {
    readonly ilike: {
      readonly self: TextualSelfSpec;
      readonly impl: (
        self: TextualSelf<CT>,
        pattern: TextArgument<CT>,
      ) => Expression<{ codecId: 'pg/bool@1'; nullable: false }>;
    };
    readonly fullTextMatches: {
      readonly self: TextualSelfSpec;
      readonly impl: (
        self: TextualSelf<CT>,
        query: TsqueryArgument<CT>,
        options?: FullTextMatchesOptions,
      ) => Expression<{ codecId: 'pg/bool@1'; nullable: false }>;
    };
    readonly fullTextRank: {
      readonly self: TextualSelfSpec;
      readonly impl: (
        self: TextualSelf<CT>,
        query: TsqueryArgument<CT>,
        options?: FullTextRankOptions,
      ) => Expression<{ codecId: 'pg/float4@1'; nullable: false }>;
    };
    readonly fullTextHeadline: {
      readonly self: TextualSelfSpec;
      readonly impl: (
        self: TextualSelf<CT>,
        query: TsqueryArgument<CT>,
        options?: FullTextHeadlineOptions,
      ) => Expression<{ codecId: 'pg/text@1'; nullable: false }>;
    };
    readonly websearchToTsquery: TsqueryParser;
    readonly toTsquery: TsqueryParser;
    readonly plaintoTsquery: TsqueryParser;
    readonly phrasetoTsquery: TsqueryParser;
  }
>;
