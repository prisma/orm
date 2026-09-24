import type { Expression } from '@internal/sql-relational-core/expression';
import { expectTypeOf, test } from 'vitest';
import type { CodecTypes } from '../src/exports/codec-types';
import {
  phrasetoTsquery,
  plaintoTsquery,
  type RawTsquery,
  rawTsquery,
  toTsquery,
  tsquery,
  websearchToTsquery,
} from '../src/exports/full-text';
import type { QueryOperationTypes, TsqueryArgument } from '../src/exports/operation-types';

type Tsquery = Expression<{ codecId: 'pg/tsquery@1'; nullable: false }>;
type TextColumn = Expression<{ codecId: 'pg/text@1'; nullable: false }>;

test('the codec type map carries pg/tsquery@1 as a raw tsquery in and out', () => {
  expectTypeOf<CodecTypes['pg/tsquery@1']['input']>().toEqualTypeOf<RawTsquery>();
  expectTypeOf<CodecTypes['pg/tsquery@1']['output']>().toEqualTypeOf<RawTsquery>();
});

test('rawTsquery brands a string, and a raw tsquery is still a string', () => {
  expectTypeOf(rawTsquery('zeb:*')).toEqualTypeOf<RawTsquery>();
  expectTypeOf<RawTsquery>().toExtend<string>();
});

test('the query is a parser expression or a raw tsquery, never a bare string', () => {
  for (const parse of [websearchToTsquery, toTsquery, plaintoTsquery, phrasetoTsquery]) {
    expectTypeOf(parse('zebra')).toEqualTypeOf<Tsquery>();
  }
  expectTypeOf<Tsquery>().toExtend<TsqueryArgument<CodecTypes>>();
  expectTypeOf<RawTsquery>().toExtend<TsqueryArgument<CodecTypes>>();
  expectTypeOf<string>().not.toExtend<TsqueryArgument<CodecTypes>>();
  expectTypeOf<number>().not.toExtend<TsqueryArgument<CodecTypes>>();
  expectTypeOf<TextColumn>().not.toExtend<TsqueryArgument<CodecTypes>>();
});

test('the parsers are self-less operations and the search operations take a tsquery', () => {
  type Ops = QueryOperationTypes<CodecTypes>;
  expectTypeOf<Ops['websearchToTsquery']>().not.toHaveProperty('self');
  expectTypeOf<Ops['toTsquery']['impl']>().toEqualTypeOf<typeof toTsquery>();
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

test('the tsquery tag takes only string values and gives a tsquery the operations accept', () => {
  expectTypeOf(tsquery`${'zeb'}:*`).toEqualTypeOf<Tsquery>();
  expectTypeOf(tsquery({ language: 'german' })`${'zeb'}:*`).toEqualTypeOf<Tsquery>();
  // @ts-expect-error an interpolated value is a string, never a number
  tsquery`${42}:*`;
  // @ts-expect-error nor a tsquery expression, which would not be quoted as one term
  tsquery`${websearchToTsquery('zebra')}:*`;
  // @ts-expect-error 'klingon' is not a PostgreSQL text-search configuration
  tsquery({ language: 'klingon' });
});
