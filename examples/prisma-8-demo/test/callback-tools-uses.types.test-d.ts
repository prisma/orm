import { Collection } from '@prisma/orm-postgres/orm-client';
import type { PostgresClient } from '@prisma/orm-postgres/runtime';
import { websearchToTsquery } from '@prisma/orm-postgres/target/full-text';
import { expectTypeOf, test } from 'vitest';
import type { Contract } from '../src/prisma/contract.d';
import { db as demoDb } from '../src/prisma/db';

declare const plainDb: PostgresClient<Contract>;

const db = demoDb.orm.public;
const plain = plainDb.orm.public;
const q = websearchToTsquery('zebra');

export class SearchPosts extends Collection<Contract, 'Post'> {
  search() {
    return this.where((_p, { fns, indexes }) => fns.fullTextMatches(indexes.post_title_search, q));
  }
}

export const use1 = db.Post.where((_p, { fns, indexes }) =>
  fns.fullTextMatches(indexes.post_title_search, q),
);
export const use2 = db.Post.orderBy((_p, { fns, indexes }) =>
  fns.fullTextRank(indexes.post_title_search, q).desc(),
);
export const use3 = plain.Post.select('id')
  .limit(3)
  .where((_p, { fns, indexes }) => fns.fullTextMatches(indexes.post_title_search, q));
export const use4 = plain.User.include('posts', (posts) =>
  posts.where((_p, { fns, indexes }) => fns.fullTextMatches(indexes.post_title_search, q)),
);
export const use5 = plain.User.where((u) =>
  u.posts.some((_p, { fns, indexes }) => fns.fullTextMatches(indexes.post_title_search, q)),
);
export const use6 = plain.Post.fragment((posts) =>
  posts.orderBy((_p, { fns, indexes }) => fns.fullTextRank(indexes.post_title_search, q).desc()),
);
export const use7 = SearchPosts;
export const use8 = plain.Post.first((_p, { fns, indexes }) =>
  fns.fullTextMatches(indexes.post_title_search, q),
);
export const use9 = plain.User.where((u, { fns }) => fns.eq(u.email, u.displayName));
export const use10 = plain.Post.orderBy([
  (_p, { fns, indexes }) => fns.fullTextRank(indexes.post_title_search, q).desc(),
  (p) => p.id.asc(),
]);

test('ten uses of the second callback argument, one per site, type-check', () => {
  expectTypeOf(q).not.toBeAny();
});
