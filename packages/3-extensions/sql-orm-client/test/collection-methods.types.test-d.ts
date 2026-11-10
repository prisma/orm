import { int4Column } from '@internal/adapter-postgres/column-types';
import { field } from '@internal/sql-contract-ts/contract-builder';
import {
  type PostgresTsqueryArgument,
  websearchToTsquery,
} from '@internal/target-postgres/full-text';
import { describe, expectTypeOf, test } from 'vitest';
import { Collection } from '../src/collection';
import type {
  CollectionMethodNameClash,
  ContributedCollectionMethods,
  ModelContributedMethodTable,
} from '../src/collection-methods';
import type {
  CollectionRowOf,
  Filtered,
  HasOrderBy,
  HasWhere,
  Ordered,
} from '../src/collection-types';
import { orm } from '../src/orm';
import type { TestVector } from './collection-methods-fixture';
import {
  createCollectionMethodsOrm,
  type SearchableUserCollection,
} from './collection-methods-orm-fixture';
import { createMockRuntime, getTestContext, type TestContract } from './helpers';

const { db, plain, notes, extended, fragment } = createCollectionMethodsOrm();
const q = websearchToTsquery('alice');

describe('using', () => {
  test('has the methods each contribution gives the model, under the names it chose', () => {
    expectTypeOf(plain.User.using).not.toBeAny();
    expectTypeOf<keyof typeof plain.User.using>().toEqualTypeOf<'users_search'>();
    expectTypeOf<keyof typeof notes.Note.using>().toEqualTypeOf<'notes_search'>();
    expectTypeOf<keyof typeof extended.Reading.using>().toEqualTypeOf<
      'embedding_closest' | 'as_of'
    >();
  });

  test('has no methods from the test-only contributions on a model without their marker', () => {
    expectTypeOf<keyof typeof plain.Post.using>().toBeNever();
    expectTypeOf<keyof typeof plain.Tag.using>().toBeNever();
  });

  test('serves a collection narrowed by variant from the base model table', () => {
    const memos = notes.Note.variant('memo');
    expectTypeOf<keyof typeof memos.using>().toEqualTypeOf<'notes_search'>();
    expectTypeOf(memos.using.notes_search(q)).toExtend<HasWhere & HasOrderBy>();
  });

  test('has no method under the physical name of an index', () => {
    // @ts-expect-error the hashed physical name is not a method name
    plain.User.using.users_search_1d1ec8a9;
  });

  test('has no members for a model no contribution gives a method', () => {
    expectTypeOf(plain.Comment.using).toEqualTypeOf<Record<never, never>>();
    // @ts-expect-error Comment has no full-text index
    plain.Comment.using.users_search;
  });

  test('refuses a misspelled method name', () => {
    // @ts-expect-error no contribution gives User a method `search`
    plain.User.using.search(q);
  });

  test('refuses an argument of the wrong type', () => {
    // @ts-expect-error a full-text method takes a tsquery, not a string
    plain.User.using.users_search('alice');
  });

  test('has no members when the model name is not known', () => {
    expectTypeOf<ModelContributedMethodTable<TestContract, string, 'public'>>().toEqualTypeOf<
      Record<never, never>
    >();
    expectTypeOf<ModelContributedMethodTable<TestContract, 'User', string>>().toEqualTypeOf<
      Record<never, never>
    >();
  });

  test('is a member a custom class cannot redeclare', () => {
    class Redeclared extends Collection<TestContract, 'User'> {
      // @ts-expect-error `using` is an accessor of every collection
      using() {
        return 1;
      }
    }
    expectTypeOf<Redeclared>().not.toBeAny();
  });
});

describe('a contribution that reads the whole model', () => {
  test('names a method after a field of a codec, and types its argument from the field', () => {
    expectTypeOf(extended.Reading.using.embedding_closest)
      .parameter(0)
      .toEqualTypeOf<TestVector<3>>();
    expectTypeOf(extended.Reading.using.embedding_closest([1, 2, 3])).toExtend<HasOrderBy>();
  });

  test('offers a method with a fixed name on a model whose table has a column of a codec', () => {
    expectTypeOf(extended.Reading.using.as_of).parameter(0).toEqualTypeOf<Date>();
    // @ts-expect-error Tag has no json column, so it has no as_of
    extended.Tag.using.as_of(new Date());
  });
});

describe('the facts a contributed method adds', () => {
  test('are only those its signature declares', () => {
    const ordered = extended.Reading.using.embedding_closest([1, 2, 3]);
    expectTypeOf(ordered).toEqualTypeOf<Ordered<typeof extended.Reading>>();
    expectTypeOf(ordered).not.toExtend<HasWhere>();
  });

  test('allow a bulk write only after a method that filters', () => {
    // @ts-expect-error an order-only method does not filter, so deleteAll would delete every row
    extended.Reading.using.embedding_closest([1, 2, 3]).deleteAll();
    // @ts-expect-error an order-only method does not filter, so updateAll would update every row
    extended.Reading.using.embedding_closest([1, 2, 3]).updateAll({ payload: null });
    expectTypeOf(plain.User.using.users_search(q).deleteAll).toBeFunction();
  });
});

describe('two contributions that give a model the same method name', () => {
  test('type the name as a clash that names the model and both contributions', () => {
    expectTypeOf(extended.Tag.using.labelled).toEqualTypeOf<
      CollectionMethodNameClash<'labelled', 'Tag', 'test/clash-a' | 'test/clash-b'>
    >();
  });

  test('make a call a compile error', () => {
    // @ts-expect-error the method name is contributed twice
    extended.Tag.using.labelled('x');
  });
});

describe('a contributed method', () => {
  test('returns the collection it was called on, filtered and ordered', () => {
    const result = plain.User.using.users_search(q);
    expectTypeOf(result).not.toBeAny();
    expectTypeOf(result).toEqualTypeOf<Ordered<Filtered<typeof plain.User>>>();
    expectTypeOf(result).toExtend<HasWhere & HasOrderBy>();
    expectTypeOf(result.limit(3).all).toBeFunction();
  });

  test('keeps a custom collection class', () => {
    const result = db.User.using.users_search(q);
    expectTypeOf(result).toExtend<SearchableUserCollection & HasWhere & HasOrderBy>();
    expectTypeOf(result.named('a').relevant(q)).toExtend<SearchableUserCollection>();
  });

  test('keeps the row type chosen before the call', () => {
    const result = plain.User.select('id').using.users_search(q);
    expectTypeOf<CollectionRowOf<typeof result>>().toEqualTypeOf<{ id: number }>();
  });

  test('is offered after where, limit and orderBy', () => {
    expectTypeOf(db.User.named('a').limit(5).using.users_search(q)).toExtend<
      SearchableUserCollection & HasWhere & HasOrderBy
    >();
    expectTypeOf(plain.User.orderBy((u) => u.id.asc()).using.users_search(q)).toExtend<
      HasWhere & HasOrderBy
    >();
  });

  test('is offered inside an include refinement', () => {
    const result = plain.User.include('invitedUsers', (invited) =>
      invited.using.users_search(q).limit(3),
    );
    expectTypeOf(result).not.toBeAny();
  });

  test('is offered on this inside a custom collection method', () => {
    expectTypeOf(db.User.relevant(q)).toExtend<SearchableUserCollection & HasWhere & HasOrderBy>();
    expectTypeOf(db.User.relevant(q)).not.toBeAny();
  });

  test('is offered on this inside a generic collection subclass', () => {
    class Library<Model extends 'User' | 'Post'> extends Collection<TestContract, Model> {
      methods() {
        return this.using;
      }
    }
    class UserLibrary extends Library<'User'> {
      search(query: PostgresTsqueryArgument) {
        return this.using.users_search(query);
      }
    }
    const users = orm({
      runtime: createMockRuntime(),
      context: getTestContext(),
      collections: { User: UserLibrary },
    }).public.User;
    expectTypeOf(users.search(q)).not.toBeAny();
    expectTypeOf(users.search(q)).toExtend<UserLibrary & HasWhere & HasOrderBy>();
  });

  test('is offered inside with and inside a fragment for one model', () => {
    const viaWith = plain.User.with((users) => users.using.users_search(q));
    const search = plain.User.fragment((users) => users.using.users_search(q));
    const viaFragment = plain.User.with(search);
    expectTypeOf(viaWith).not.toBeAny();
    expectTypeOf(viaWith).toExtend<HasWhere & HasOrderBy>();
    expectTypeOf(viaFragment).toExtend<HasWhere & HasOrderBy>();
  });

  test('is not offered inside a fragment for any model', () => {
    fragment({ id: field.column(int4Column) }, (rows) => {
      // @ts-expect-error a fragment for any model reads no model
      rows.using;
      return rows;
    });
  });

  test('infers its receiver from an expected subtype, but not from an unrelated type', () => {
    const subtype: Filtered<typeof plain.User> = plain.User.using.users_search(q);
    expectTypeOf(subtype).toExtend<HasWhere>();
    // @ts-expect-error a number is not a collection
    const unrelated: number = plain.User.using.users_search(q);
    expectTypeOf(unrelated).toBeNumber();
  });
});

test('ContributedCollectionMethods names the model in its type arguments', () => {
  expectTypeOf(plain.User.using).toEqualTypeOf<
    ContributedCollectionMethods<TestContract, 'User', 'public', typeof plain.User>
  >();
});
