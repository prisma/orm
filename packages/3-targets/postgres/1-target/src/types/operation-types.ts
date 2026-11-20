import type {
  QueryOperationTypesFunction,
  SqlQueryOperationTypes,
} from '@internal/sql-contract/types';
import type {
  CodecExpression,
  Expression,
  TraitExpression,
} from '@internal/sql-relational-core/expression';
import type { FullTextDocument } from '../core/full-text-document';
import type { FULL_TEXT_INDEX_TYPE } from '../core/full-text-index-definition';
import type {
  FullTextHeadlineOptions,
  FullTextMatchesOptions,
  FullTextRankOptions,
} from '../core/full-text-options';
import type { TsqueryParser } from '../core/full-text-parsers';
import type { FullTextWeightGroups } from '../core/full-text-weight-groups';
import type { FullTextSearchLanguage } from '../core/text-search-languages';

type CodecTypesBase = Record<string, { readonly input: unknown; readonly output: unknown }>;

type TextualSelfSpec = { readonly traits: readonly ['textual'] };

type TextualSelf<CT extends CodecTypesBase> = TraitExpression<readonly ['textual'], false, CT>;

/** A textual column whose nullability the operation's result follows. */
type TextualColumn<Nullable extends boolean, CT extends CodecTypesBase> = TraitExpression<
  readonly ['textual'],
  Nullable,
  CT
> & { buildAst(): unknown };

type NullableTextualSelf<Nullable extends boolean, CT extends CodecTypesBase> =
  | TextualSelf<CT>
  | TextualColumn<Nullable, CT>;

type Condition<Nullable extends boolean> = Expression<{ codecId: 'pg/bool@1'; nullable: Nullable }>;

/**
 * Whether the search document of an index can be null. A document of one column is null where that
 * column is; with more columns each is wrapped in `coalesce`, so it never is.
 */
type IndexDocumentNullable<Columns> = {
  [Name in keyof Columns]: [Exclude<keyof Columns, Name>] extends [never]
    ? Columns[Name] extends {
        readonly returnType: { readonly nullable: infer Nullable extends boolean };
      }
      ? Nullable
      : false
    : false;
}[keyof Columns];

type TextOperand<CT extends CodecTypesBase> = CodecExpression<'pg/text@1', false, CT>;

/** A textual column, nullable or not, as an expression rather than a value. */
type FullTextColumn<CT extends CodecTypesBase> = Extract<
  TraitExpression<readonly ['textual'], boolean, CT>,
  { buildAst(): unknown }
>;

/**
 * A full-text index of a table, as the SQL builder's `table.indexes.<name>` gives it. The
 * operation searches the document the index was built over: its weight groups and its language.
 */
export interface FullTextIndexReference<
  CT extends CodecTypesBase,
  Columns extends Readonly<Record<string, FullTextColumn<CT>>> = Readonly<
    Record<string, FullTextColumn<CT>>
  >,
> {
  readonly type: typeof FULL_TEXT_INDEX_TYPE;
  readonly options: {
    readonly weightGroups: FullTextWeightGroups<string>;
    readonly language: FullTextSearchLanguage;
  };
  readonly columns: Columns;
}

/** The options of a full-text operation given an index, which states the language itself. */
type WithoutLanguage<Options> = Omit<Options, 'language'> & { readonly language?: never };

/**
 * The query side of a full-text operation: a `tsquery` expression from a parser or the `tsquery` tag
 * in `full-text`, or a `tsquery` value read back from a query, bound as a `tsquery` parameter. A
 * bare string is not accepted.
 */
export type TsqueryArgument<CT extends CodecTypesBase> = CodecExpression<'pg/tsquery@1', false, CT>;

type TsqueryParserOperation = { readonly impl: TsqueryParser };

export type QueryOperationTypes<CT extends CodecTypesBase> = SqlQueryOperationTypes<
  CT,
  {
    readonly ilike: {
      readonly self: TextualSelfSpec;
      readonly impl: <Nullable extends boolean = false>(
        self: NullableTextualSelf<Nullable, CT>,
        pattern: TextOperand<CT>,
      ) => Condition<Nullable>;
    };
    /**
     * The document is a full-text index from a table's `indexes`, a textual column, or a
     * `fullTextDocument`. The receiver spec names the column form, which is the one the column
     * methods dispatch on, so that overload comes last.
     */
    readonly fullTextMatches: {
      readonly self: TextualSelfSpec;
      readonly impl: {
        <Columns extends Readonly<Record<string, FullTextColumn<CT>>>>(
          index: FullTextIndexReference<CT, Columns>,
          query: TsqueryArgument<CT>,
          options?: WithoutLanguage<FullTextMatchesOptions>,
        ): Condition<IndexDocumentNullable<Columns>>;
        <Nullable extends boolean = false>(
          document: NullableTextualSelf<Nullable, CT> | FullTextDocument<Nullable>,
          query: TsqueryArgument<CT>,
          options?: FullTextMatchesOptions,
        ): Condition<Nullable>;
      };
    };
    /**
     * The document is a full-text index from a table's `indexes`, a textual column, or a
     * `fullTextDocument`. The receiver spec names the column form, which is the one the column
     * methods dispatch on, so that overload comes last.
     */
    readonly fullTextRank: {
      readonly self: TextualSelfSpec;
      readonly impl: {
        (
          index: FullTextIndexReference<CT>,
          query: TsqueryArgument<CT>,
          options?: WithoutLanguage<FullTextRankOptions>,
        ): Expression<{ codecId: 'pg/float4@1'; nullable: false }>;
        (
          document: TextualSelf<CT> | FullTextDocument,
          query: TsqueryArgument<CT>,
          options?: FullTextRankOptions,
        ): Expression<{ codecId: 'pg/float4@1'; nullable: false }>;
      };
    };
    readonly fullTextHeadline: {
      readonly self: TextualSelfSpec;
      readonly impl: (
        self: TextualSelf<CT>,
        query: TsqueryArgument<CT>,
        options?: FullTextHeadlineOptions,
      ) => Expression<{ codecId: 'pg/text@1'; nullable: false }>;
    };
    readonly websearchToTsquery: TsqueryParserOperation;
    readonly toTsquery: TsqueryParserOperation;
    readonly plaintoTsquery: TsqueryParserOperation;
    readonly phrasetoTsquery: TsqueryParserOperation;
  }
>;

/** {@link QueryOperationTypes} as a function of the contract's codec types, for a contract written in TypeScript. */
export interface QueryOperationTypesForCodecs extends QueryOperationTypesFunction {
  readonly queryOperationTypes: QueryOperationTypes<this['codecTypes']>;
}
