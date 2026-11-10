import type {
  CollectionMethodBody,
  CollectionMethodContribution,
  CollectionMethodContributionId,
  CollectionMethodContributionType,
  CollectionMethodModelType,
  CollectionMethodTools,
} from '@internal/sql-relational-core/collection-methods';
import {
  type IndexReference,
  type UniqueIndexNamesOfType,
  uniqueIndexNamesOfType,
} from '@internal/sql-relational-core/index-reference';
import { blindCast } from '@internal/utils/casts';
import type { TsqueryArgument } from '../types/operation-types';
import type { ExtractedCodecTypes, Resolve } from './codec-type-map';
import { FULL_TEXT_INDEX_TYPE } from './full-text-index-definition';

/** A `tsquery` expression from a parser or the `tsquery` tag, or a `tsquery` value read back from a query. */
export type PostgresTsqueryArgument = TsqueryArgument<Resolve<ExtractedCodecTypes>>;

interface FullTextSearchSignature {
  readonly parameters: readonly [query: PostgresTsqueryArgument];
  readonly filters: true;
  readonly orders: true;
}

type FullTextMethodTable<Model extends CollectionMethodModelType> =
  Model['target'] extends 'postgres'
    ? {
        readonly [Name in UniqueIndexNamesOfType<
          Model['table']['indexes'][number],
          typeof FULL_TEXT_INDEX_TYPE
        >]: FullTextSearchSignature;
      }
    : Record<never, never>;

/** One method for each full-text index of a Postgres model, named after the index: `using.<index>(query)` filters to the rows that match `query`, most relevant first. */
export interface PostgresFullTextMethods extends CollectionMethodContributionType {
  readonly methods: FullTextMethodTable<this['model']>;
}

declare module '@internal/sql-relational-core/collection-methods' {
  interface CollectionMethodRegistry {
    readonly 'postgres/fullText': PostgresFullTextMethods;
  }
}

type IndexFunction = (index: IndexReference | undefined, ...args: never[]) => { desc(): unknown };

function indexFunction(
  tools: CollectionMethodTools,
  name: 'fullTextMatches' | 'fullTextRank',
): IndexFunction {
  return blindCast<
    IndexFunction,
    'this target registers fullTextMatches and fullTextRank, which take an index and a tsquery'
  >(tools.fns[name]);
}

function fullTextMethod(indexName: string): CollectionMethodBody {
  return (collection, ...args) =>
    collection
      .where((_model, tools) =>
        indexFunction(tools, 'fullTextMatches')(tools.indexes[indexName], ...args),
      )
      .orderBy((_model, tools) =>
        indexFunction(tools, 'fullTextRank')(tools.indexes[indexName], ...args).desc(),
      );
}

/** The run-time half of `PostgresFullTextMethods`. */
export const postgresFullTextMethods: CollectionMethodContribution = {
  id: 'postgres/fullText' satisfies CollectionMethodContributionId,
  methodsFor: (model) =>
    Object.fromEntries(
      uniqueIndexNamesOfType(model.table.indexes, FULL_TEXT_INDEX_TYPE).map((name) => [
        name,
        fullTextMethod(name),
      ]),
    ),
};
