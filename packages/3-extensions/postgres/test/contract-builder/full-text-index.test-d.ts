/**
 * `fullTextIndex` keeps its `name` literal, so the model's `sql()` stage can see
 * the index's name and refuse a duplicate exactly as it does for
 * `constraints.index`. A `map:` index carries no wire name and so never collides.
 */
import type { ColumnRef, ContractModelBuilder } from '@internal/sql-contract-ts/contract-builder';
import { expectTypeOf, test } from 'vitest';
import { defineContract, field, fullTextIndex, model } from '../../src/exports/contract-builder';

const intColumn = { codecId: 'pg/int4@1', nativeType: 'int4' } as const;
const textColumn = { codecId: 'pg/text@1', nativeType: 'text' } as const;

const fields = { id: field.column(intColumn).id(), text: field.column(textColumn) };

test('the name stays literal rather than widening to string', () => {
  const index = fullTextIndex<'message_search'>(
    { kind: 'columnRef', fieldName: 'text' },
    { name: 'message_search' },
  );
  expectTypeOf(index.name).toEqualTypeOf<'message_search' | undefined>();
});

test('a map: index carries no wire name', () => {
  const index = fullTextIndex({ kind: 'columnRef', fieldName: 'text' }, { map: 'message_search' });
  expectTypeOf(index.name).toEqualTypeOf<undefined>();
});

type SqlSpecOf<Builder> =
  Builder extends ContractModelBuilder<
    infer _ModelName,
    infer _Fields,
    infer _Relations,
    infer _Attributes,
    infer SqlSpec,
    infer _IndexTypes,
    infer _SpaceId
  >
    ? SqlSpec
    : never;

type IsNever<T> = [T] extends [never] ? true : false;

const text: ColumnRef<'text'> = { kind: 'columnRef', fieldName: 'text' };

test('two indexes with distinct names are accepted', () => {
  const message = model('Message', { fields }).sql({
    table: 'message',
    indexes: [
      fullTextIndex(text, { name: 'message_search' }),
      fullTextIndex(text, { language: 'german', name: 'message_search_de' }),
    ],
  });
  expectTypeOf<IsNever<SqlSpecOf<typeof message>>>().toEqualTypeOf<false>();
});

test('two indexes with the same name are rejected by the sql() stage', () => {
  const message = model('Message', { fields }).sql({
    table: 'message',
    indexes: [
      fullTextIndex(text, { name: 'message_search' }),
      fullTextIndex(text, { language: 'german', name: 'message_search' }),
    ],
  });
  expectTypeOf<IsNever<SqlSpecOf<typeof message>>>().toEqualTypeOf<true>();
});

test('a fullTextIndex and a constraints.index with the same name are rejected', () => {
  const message = model('Message', { fields }).sql(({ cols, constraints }) => ({
    table: 'message',
    indexes: [
      fullTextIndex(cols.text, { name: 'message_search' }),
      constraints.index([cols.id], { name: 'message_search' }),
    ],
  }));
  expectTypeOf<IsNever<SqlSpecOf<typeof message>>>().toEqualTypeOf<true>();
});

test('defineContract rejects a model whose sql() stage reuses an index name', () => {
  const message = model('Message', { fields }).sql({
    table: 'message',
    indexes: [
      fullTextIndex(text, { name: 'message_search' }),
      fullTextIndex(text, { language: 'german', name: 'message_search' }),
    ],
  });
  // @ts-expect-error the sql() stage resolved to never
  defineContract({ models: { Message: message } });
});
