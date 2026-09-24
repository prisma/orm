import type { Expression } from '@internal/sql-relational-core/expression';
import { expectTypeOf, test } from 'vitest';
import type { CodecTypes } from '../src/exports/codec-types';
import { websearchToTsquery } from '../src/exports/full-text';
import type { QueryOperationTypes, TsqueryArgument } from '../src/exports/operation-types';

type Tsquery = Expression<{ codecId: 'pg/tsquery@1'; nullable: false }>;

test('the codec type map carries pg/tsquery@1 as a string in and out', () => {
  expectTypeOf<CodecTypes['pg/tsquery@1']['input']>().toEqualTypeOf<string>();
  expectTypeOf<CodecTypes['pg/tsquery@1']['output']>().toEqualTypeOf<string>();
});

test('a parser returns exactly the tsquery expression the operations accept', () => {
  expectTypeOf(websearchToTsquery('zebra')).toEqualTypeOf<Tsquery>();
  expectTypeOf<Tsquery>().toExtend<TsqueryArgument<CodecTypes>>();
  expectTypeOf<string>().toExtend<TsqueryArgument<CodecTypes>>();
  expectTypeOf<number>().not.toExtend<TsqueryArgument<CodecTypes>>();
});

test('the parsers are self-less operations and the search operations take a tsquery', () => {
  type Ops = QueryOperationTypes<CodecTypes>;
  expectTypeOf<Ops['websearchToTsquery']>().not.toHaveProperty('self');
  expectTypeOf<Ops['toTsquery']['impl']>().returns.toEqualTypeOf<Tsquery>();
  expectTypeOf<Parameters<Ops['fullTextMatches']['impl']>[1]>().toEqualTypeOf<
    TsqueryArgument<CodecTypes>
  >();
  expectTypeOf<Parameters<Ops['fullTextRank']['impl']>[1]>().toEqualTypeOf<
    TsqueryArgument<CodecTypes>
  >();
  expectTypeOf<Parameters<Ops['fullTextHeadline']['impl']>[1]>().toEqualTypeOf<
    TsqueryArgument<CodecTypes>
  >();
});
