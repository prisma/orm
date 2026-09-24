import type { Expression } from '@internal/sql-relational-core/expression';
import { expectTypeOf, test } from 'vitest';
import type { CodecTypes } from '../src/exports/codec-types';
import {
  phrasetoTsquery,
  plaintoTsquery,
  toTsquery,
  tsquery,
  websearchToTsquery,
} from '../src/exports/full-text';
import type { QueryOperationTypes, TsqueryArgument } from '../src/exports/operation-types';

type Tsquery = Expression<{ codecId: 'pg/tsquery@1'; nullable: false }>;
type TextColumn = Expression<{ codecId: 'pg/text@1'; nullable: false }>;
type TsqueryValue = CodecTypes['pg/tsquery@1']['output'];

test('a tsquery value is a string that a bare string cannot stand in for', () => {
  expectTypeOf<CodecTypes['pg/tsquery@1']['input']>().toEqualTypeOf<TsqueryValue>();
  expectTypeOf<TsqueryValue>().toExtend<string>();
  expectTypeOf<string>().not.toExtend<TsqueryValue>();
});

test('the query is a parser expression or a tsquery value read back, never a bare string', () => {
  for (const parse of [websearchToTsquery, toTsquery, plaintoTsquery, phrasetoTsquery]) {
    expectTypeOf(parse('zebra')).toEqualTypeOf<Tsquery>();
  }
  expectTypeOf<Tsquery>().toExtend<TsqueryArgument<CodecTypes>>();
  expectTypeOf<TsqueryValue>().toExtend<TsqueryArgument<CodecTypes>>();
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

test('a parser takes a string or any textual column, and nothing else', () => {
  type Column<CodecId extends string> = Expression<{ codecId: CodecId; nullable: false }>;
  const column = <CodecId extends string>(): Column<CodecId> => null as unknown as Column<CodecId>;

  websearchToTsquery('zebra');
  websearchToTsquery(column<'pg/text@1'>());
  toTsquery(column<'sql/varchar@1'>());
  plaintoTsquery(column<'pg/varchar@1'>());
  phrasetoTsquery(column<'pg/char@1'>());
  // @ts-expect-error an integer column is not text
  websearchToTsquery(column<'pg/int4@1'>());
  // @ts-expect-error nor is a number
  websearchToTsquery(42);
  // @ts-expect-error a tsquery is already parsed
  websearchToTsquery(column<'pg/tsquery@1'>());
  // @ts-expect-error Postgres has no text-search function over a native enum type
  websearchToTsquery(column<'pg/enum@1'>());
  // @ts-expect-error a nullable text column may hold no text to parse
  websearchToTsquery(null as unknown as Expression<{ codecId: 'pg/text@1'; nullable: true }>);
});

test('ilike and the search operations take a textual column and refuse a native enum', () => {
  type Ops = QueryOperationTypes<CodecTypes>;
  type SelfOf<Name extends 'ilike' | 'fullTextMatches' | 'fullTextRank' | 'fullTextHeadline'> =
    Parameters<Ops[Name]['impl']>[0];
  type NativeEnumColumn = Expression<{ codecId: 'pg/enum@1'; nullable: false }>;

  expectTypeOf<TextColumn>().toExtend<SelfOf<'ilike'>>();
  expectTypeOf<TextColumn>().toExtend<SelfOf<'fullTextMatches'>>();
  expectTypeOf<TextColumn>().toExtend<SelfOf<'fullTextRank'>>();
  expectTypeOf<TextColumn>().toExtend<SelfOf<'fullTextHeadline'>>();
  expectTypeOf<NativeEnumColumn>().not.toExtend<SelfOf<'ilike'>>();
  expectTypeOf<NativeEnumColumn>().not.toExtend<SelfOf<'fullTextMatches'>>();
  expectTypeOf<NativeEnumColumn>().not.toExtend<SelfOf<'fullTextRank'>>();
  expectTypeOf<NativeEnumColumn>().not.toExtend<SelfOf<'fullTextHeadline'>>();
});
