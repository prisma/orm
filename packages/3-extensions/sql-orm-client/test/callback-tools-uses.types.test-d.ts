import { websearchToTsquery } from '@internal/target-postgres/full-text';
import { expectTypeOf, test } from 'vitest';
import { Collection } from '../src/collection';
import { createChainingOrm } from './collection-chaining-fixture';
import type { TestContract as Contract } from './helpers';

const { db, plain } = createChainingOrm();
const q = websearchToTsquery('zebra');

export class SearchUsers extends Collection<Contract, 'User'> {
  search() {
    return this.where((_p, { fns, indexes }) => fns.fullTextMatches(indexes.users_search, q));
  }
}

const use1 = db.User.where((_p, { fns, indexes }) => fns.fullTextMatches(indexes.users_search, q));
const use2 = db.User.orderBy((_p, { fns, indexes }) =>
  fns.fullTextRank(indexes.users_search, q).desc(),
);
const use3 = plain.User.select('id')
  .limit(3)
  .where((_p, { fns, indexes }) => fns.fullTextMatches(indexes.users_search, q));
const use4 = plain.User.include('invitedUsers', (posts) =>
  posts.where((_p, { fns, indexes }) => fns.fullTextMatches(indexes.users_search, q)),
);
const use5 = plain.User.where((u) =>
  u.invitedUsers.some((_p, { fns, indexes }) => fns.fullTextMatches(indexes.users_search, q)),
);
const use6 = plain.User.fragment((posts) =>
  posts.orderBy((_p, { fns, indexes }) => fns.fullTextRank(indexes.users_search, q).desc()),
);
const use7 = SearchUsers;
const use8 = plain.User.first((_p, { fns, indexes }) =>
  fns.fullTextMatches(indexes.users_search, q),
);
const use9 = plain.User.where((u, { fns }) => fns.eq(u.email, u.name));
const use10 = plain.User.orderBy([
  (_p, { fns, indexes }) => fns.fullTextRank(indexes.users_search, q).desc(),
  (p) => p.id.asc(),
]);

test('ten uses of the second callback argument, one per site, type-check', () => {
  expectTypeOf([use1, use2, use3, use4, use5, use6, use7, use8, use9, use10]).not.toBeAny();
});
