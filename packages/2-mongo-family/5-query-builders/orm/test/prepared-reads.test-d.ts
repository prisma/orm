import type { AsyncIterableResult } from '@internal/framework-components/runtime';
import type { MongoPreparable } from '@internal/mongo-query-ast/execution';
import type { MongoPreparedParamRef } from '@internal/mongo-value';
import { describe, expectTypeOf, test } from 'vitest';
import type { Contract } from '../../../1-foundation/mongo-contract/test/fixtures/orm-contract';
import type { MongoCollection } from '../src/collection';
import type { IncludedRow } from '../src/types';
import type { ListsContract } from './fixtures/lists-contract';

declare const users: MongoCollection<Contract, 'User'>;
declare const lists: MongoCollection<ListsContract, 'Lists'>;

declare const text: MongoPreparedParamRef<'mongo/string@1', false>;
declare const nullableText: MongoPreparedParamRef<'mongo/string@1', true>;
declare const id: MongoPreparedParamRef<'mongo/objectId@1', false>;
declare const count: MongoPreparedParamRef<'mongo/int32@1', false>;
declare const nullableCount: MongoPreparedParamRef<'mongo/int32@1', true>;

type UserRow = IncludedRow<Contract, 'User'>;

describe('.prepared on a Mongo collection', () => {
  test('all() describes a row stream', () => {
    expectTypeOf(users.prepared.all()).toEqualTypeOf<
      MongoPreparable<Record<string, unknown>, AsyncIterableResult<UserRow>>
    >();
  });

  test('first() describes one row or null', () => {
    expectTypeOf(users.prepared.first()).toEqualTypeOf<
      MongoPreparable<Record<string, unknown>, Promise<UserRow | null>>
    >();
  });

  test('a read with an include describes the included rows', () => {
    const withTasks = users.include('tasks');
    expectTypeOf(withTasks.prepared.all()).toEqualTypeOf<
      MongoPreparable<
        Record<string, unknown>,
        AsyncIterableResult<IncludedRow<Contract, 'User', { tasks: true }>>
      >
    >();
  });
});

describe('a placeholder in an object-form where', () => {
  test('takes a placeholder with the field codec', () => {
    users.where({ name: text, loginCount: count, _id: id });
  });

  test('rejects a placeholder with another codec', () => {
    // @ts-expect-error the field codec is mongo/string@1
    users.where({ name: count });
    // @ts-expect-error the field codec is mongo/int32@1
    users.where({ loginCount: text });
    // @ts-expect-error the field codec is mongo/string@1
    lists.where({ name: id });
  });

  test('rejects a nullable placeholder on a field that is not nullable', () => {
    // @ts-expect-error the field is never null
    users.where({ name: nullableText });
    // @ts-expect-error the field is never null
    lists.where({ name: nullableText });
  });

  test('takes a nullable placeholder on a nullable field', () => {
    lists.where({ nickname: nullableText }).where({ nickname: text });
  });

  test('on a list field, takes a placeholder with the element codec', () => {
    users.where({ tags: text });
    lists.where({ strings: text }).where({ optionalStrings: text });
  });

  test('on a list field, rejects a nullable placeholder', () => {
    // @ts-expect-error a placeholder cannot say the field is not a list
    lists.where({ optionalStrings: nullableText });
    // @ts-expect-error a placeholder cannot say the field is not a list
    lists.where({ nullableStrings: nullableText });
  });

  test('on a list field, rejects a placeholder with another codec', () => {
    // @ts-expect-error the element codec is mongo/string@1
    users.where({ tags: count });
  });

  test('rejects a list of placeholders', () => {
    // @ts-expect-error a declaration has no list form
    users.where({ tags: [text] });
  });
});

describe('a placeholder in limit and offset', () => {
  test('takes a placeholder whose codec takes a number', () => {
    users.limit(count).offset(count);
  });

  test('rejects a placeholder whose codec does not take a number', () => {
    // @ts-expect-error mongo/string@1 takes a string
    users.limit(text);
    // @ts-expect-error mongo/string@1 takes a string
    users.offset(text);
  });

  test('rejects a nullable placeholder', () => {
    // @ts-expect-error a count is never null
    users.limit(nullableCount);
    // @ts-expect-error a count is never null
    users.offset(nullableCount);
  });
});
