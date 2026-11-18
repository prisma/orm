import type { MongoPreparedParamRef } from '@internal/mongo-value';
import { describe, expectTypeOf, test } from 'vitest';
import type { MongoCollection } from '../src/collection';
import type { MongoWhereFilter } from '../src/types';
import type { ListsContract, TestCodecTypes } from './fixtures/lists-contract';

type StringPlaceholder = MongoPreparedParamRef<'mongo/string@1', false>;

type Filter = MongoWhereFilter<ListsContract, 'Lists', TestCodecTypes>;

describe('where on a list whose container and items are not nullable (String[])', () => {
  test('takes one element or a whole list', () => {
    expectTypeOf<Filter['strings']>().toEqualTypeOf<
      string | readonly string[] | StringPlaceholder | undefined
    >();
  });

  test('rejects null and a list holding null', () => {
    // @ts-expect-error the list itself is never null
    void ({ strings: null } satisfies Filter);
    // @ts-expect-error the items are never null
    void ({ strings: ['a', null] } satisfies Filter);
  });
});

describe('where on a list whose items may be null (String?[])', () => {
  test('takes one element or a whole list whose items may be null', () => {
    expectTypeOf<Filter['nullableStrings']>().toEqualTypeOf<
      string | readonly (string | null)[] | StringPlaceholder | undefined
    >();
  });

  test('rejects null for the whole field', () => {
    // @ts-expect-error the list itself is never null
    void ({ nullableStrings: null } satisfies Filter);
  });
});

describe('where on a nullable list (String[]?)', () => {
  test('takes one element, a whole list or null', () => {
    expectTypeOf<Filter['optionalStrings']>().toEqualTypeOf<
      string | readonly string[] | StringPlaceholder | null | undefined
    >();
  });

  test('rejects a list holding null', () => {
    // @ts-expect-error the items are never null
    void ({ optionalStrings: ['a', null] } satisfies Filter);
  });
});

describe('where on a nullable list whose items may be null (String?[]?)', () => {
  test('takes one element, a whole list whose items may be null, or null', () => {
    expectTypeOf<Filter['optionalNullableStrings']>().toEqualTypeOf<
      string | readonly (string | null)[] | StringPlaceholder | null | undefined
    >();
  });
});

describe('where on fields that are not scalar lists', () => {
  test('a value-object list stays untyped', () => {
    expectTypeOf<Filter['entries']>().toEqualTypeOf<unknown>();
  });

  test('a scalar field takes only its codec output', () => {
    expectTypeOf<Filter['name']>().toEqualTypeOf<string | StringPlaceholder | undefined>();
    // @ts-expect-error a scalar field takes no list
    void ({ name: ['a'] } satisfies Filter);
    // @ts-expect-error the field is never null
    void ({ name: null } satisfies Filter);
  });

  test('a nullable scalar field also takes null', () => {
    expectTypeOf<Filter['nickname']>().toEqualTypeOf<
      string | MongoPreparedParamRef<'mongo/string@1', boolean> | null | undefined
    >();
  });
});

test('collection.where() takes each newly allowed list value', () => {
  const lists = {} as MongoCollection<ListsContract, 'Lists'>;
  expectTypeOf(
    lists
      .where({ strings: ['a', 'b'] })
      .where({ nullableStrings: ['a', null] })
      .where({ optionalStrings: null })
      .where({ optionalStrings: [] })
      .where({ optionalNullableStrings: [null] })
      .where({ optionalNullableStrings: null })
      .where({ nickname: null }),
  ).toEqualTypeOf<MongoCollection<ListsContract, 'Lists'>>();
});
