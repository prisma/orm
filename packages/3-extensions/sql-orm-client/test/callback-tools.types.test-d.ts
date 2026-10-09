import { websearchToTsquery } from '@internal/target-postgres/full-text';
import { describe, expectTypeOf, test } from 'vitest';
import { Collection } from '../src/collection';
import type { Filtered, Ordered } from '../src/collection-types';
import type { ModelAccessor, ModelCallbackTools } from '../src/exports/index';
import { orm } from '../src/orm';
import { createChainingOrm, type UserCollection } from './collection-chaining-fixture';
import { createMockRuntime, getTestContext, type TestContract } from './helpers';

const { db, plain } = createChainingOrm();
const client = orm({ runtime: createMockRuntime(), context: getTestContext() });
const q = websearchToTsquery('alice');

class SearchableUsers extends Collection<TestContract, 'User'> {
  search(query: typeof q) {
    return this.where((_u, { fns, indexes }) =>
      fns.fullTextMatches(indexes.users_search, query),
    ).orderBy((_u, { fns, indexes }) => fns.fullTextRank(indexes.users_search, query).desc());
  }
}

describe('a where callback with fns and indexes', () => {
  test('selects the callback form on a root collection', () => {
    const users = plain.User.where((_u, { fns, indexes }) =>
      fns.fullTextMatches(indexes.users_search, q),
    );
    expectTypeOf(users).not.toBeAny();
  });

  test('works after other methods', () => {
    const users = plain.User.select('id')
      .limit(5)
      .where((_u, { fns, indexes }) => fns.fullTextMatches(indexes.users_search, q));
    expectTypeOf(users).not.toBeAny();
  });

  test('keeps the class of a custom collection', () => {
    const users = db.User.where((_u, { fns, indexes }) =>
      fns.fullTextMatches(indexes.users_search, q),
    );
    expectTypeOf(users).toEqualTypeOf<Filtered<UserCollection>>();
  });

  test('works on this in a custom collection', () => {
    expectTypeOf(
      new SearchableUsers({ runtime: createMockRuntime(), context: getTestContext() }, 'User', {
        namespaceId: 'public',
      }).search(q),
    ).toEqualTypeOf<Ordered<Filtered<SearchableUsers>>>();
  });

  test('works in an include refinement', () => {
    const users = plain.User.include('invitedUsers', (invited) =>
      invited.where((_u, { fns, indexes }) => fns.fullTextMatches(indexes.users_search, q)),
    );
    expectTypeOf(users).not.toBeAny();
  });

  test('gives a relation filter the related model indexes', () => {
    plain.User.where((u) =>
      u.invitedUsers.some((_invited, { fns, indexes }) =>
        fns.fullTextMatches(indexes.users_search, q),
      ),
    );
    plain.User.where((u) =>
      u.posts.some((post, { indexes }) => {
        expectTypeOf<keyof typeof indexes>().toEqualTypeOf<'posts_user_id_idx'>();
        return post.id.eq(1);
      }),
    );
    plain.User.where((u) =>
      // @ts-expect-error a post has no users_search index
      u.posts.some((_post, { fns, indexes }) => fns.fullTextMatches(indexes.users_search, q)),
    );
  });

  test('works in the body of a fragment for one model', () => {
    const search = plain.User.fragment((users) =>
      users.where((_u, { fns, indexes }) => fns.fullTextMatches(indexes.users_search, q)),
    );
    expectTypeOf(plain.User.with(search)).not.toBeAny();
  });

  test('runs a fragment for one model inside an include refinement', () => {
    const search = plain.User.fragment((users) =>
      users
        .where((_u, { fns, indexes }) => fns.fullTextMatches(indexes.users_search, q))
        .orderBy((_u, { fns, indexes }) => fns.fullTextRank(indexes.users_search, q).desc()),
    );
    const users = plain.User.where({ id: 1 }).include('invitedUsers', (invited) =>
      invited.with(search).limit(3),
    );
    expectTypeOf(users).not.toBeAny();
  });

  test('gives the body of a fragment for any model every function and no index', () => {
    client.fragment({ name: { codecId: 'pg/text@1', nullable: false } }, (rows) =>
      rows.where((r, { fns }) => fns.fullTextMatches(r.name, q)),
    );
    client.fragment({ name: { codecId: 'pg/text@1', nullable: false } }, (rows) =>
      // @ts-expect-error the body does not know its model, so it has no index
      rows.where((_r, { fns, indexes }) => fns.fullTextMatches(indexes.users_search, q)),
    );
  });

  test('compares two fields with fns', () => {
    expectTypeOf(plain.User.where((u, { fns }) => fns.eq(u.name, u.email))).not.toBeAny();
  });

  test('still takes the shorthand object and a one-parameter callback', () => {
    expectTypeOf(plain.User.where({ name: 'Alice' })).not.toBeAny();
    expectTypeOf(plain.User.where((u) => u.name.eq('Alice'))).not.toBeAny();
  });

  test('refuses a misspelled index', () => {
    // @ts-expect-error users_serch is not an index of users
    plain.User.where((_u, { fns, indexes }) => fns.fullTextMatches(indexes.users_serch, q));
  });

  test('refuses an index that is not a full-text index', () => {
    plain.Post.where((_p, { fns, indexes }) =>
      // @ts-expect-error posts_user_id_idx is a btree index
      fns.fullTextMatches(indexes.posts_user_id_idx, q),
    );
  });

  test('refuses a language with an index', () => {
    plain.User.where((_u, { fns, indexes }) =>
      // @ts-expect-error the index states its language
      fns.fullTextMatches(indexes.users_search, q, { language: 'german' }),
    );
  });
});

describe('a reusable condition', () => {
  test('types its second parameter with the exported ModelCallbackTools', () => {
    const matchesSearch =
      (query: typeof q) =>
      (
        _u: ModelAccessor<TestContract, 'User'>,
        { fns, indexes }: ModelCallbackTools<TestContract, 'User'>,
      ) =>
        fns.fullTextMatches(indexes.users_search, query);

    expectTypeOf(plain.User.where(matchesSearch(q))).not.toBeAny();
  });
});

describe('an orderBy callback with fns and indexes', () => {
  test('orders by a value from fns', () => {
    const users = plain.User.orderBy((_u, { fns, indexes }) =>
      fns.fullTextRank(indexes.users_search, q).desc(),
    );
    expectTypeOf(users).not.toBeAny();
  });

  test('passes the second argument to each callback of an array', () => {
    const users = plain.User.orderBy([
      (_u, { fns, indexes }) => fns.fullTextRank(indexes.users_search, q).desc(),
      (u) => u.id.asc(),
    ]);
    expectTypeOf(users).not.toBeAny();
  });

  test('keeps the class of a custom collection', () => {
    const users = db.User.orderBy((_u, { fns, indexes }) =>
      fns.fullTextRank(indexes.users_search, q).desc(),
    );
    expectTypeOf(users).toEqualTypeOf<Ordered<UserCollection>>();
  });

  test('a condition from fns has no asc or desc', () => {
    plain.User.orderBy((_u, { fns, indexes }) =>
      // @ts-expect-error a condition is not an order
      fns.fullTextMatches(indexes.users_search, q).desc(),
    );
  });
});
