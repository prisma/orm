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

type CodecTypesBase = Record<string, { readonly input: unknown; readonly output: unknown }>;

type TextualSelfSpec = { readonly traits: readonly ['textual'] };

type TextualSelf<CT extends CodecTypesBase> = TraitExpression<readonly ['textual'], false, CT>;

type TextArgument<CT extends CodecTypesBase> = CodecExpression<'pg/text@1', false, CT>;

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
        query: TextArgument<CT>,
        options?: FullTextMatchesOptions,
      ) => Expression<{ codecId: 'pg/bool@1'; nullable: false }>;
    };
    readonly fullTextRank: {
      readonly self: TextualSelfSpec;
      readonly impl: (
        self: TextualSelf<CT>,
        query: TextArgument<CT>,
        options?: FullTextRankOptions,
      ) => Expression<{ codecId: 'pg/float4@1'; nullable: false }>;
    };
    readonly fullTextHeadline: {
      readonly self: TextualSelfSpec;
      readonly impl: (
        self: TextualSelf<CT>,
        query: TextArgument<CT>,
        options?: FullTextHeadlineOptions,
      ) => Expression<{ codecId: 'pg/text@1'; nullable: false }>;
    };
  }
>;
