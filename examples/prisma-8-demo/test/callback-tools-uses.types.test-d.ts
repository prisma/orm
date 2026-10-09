import type { Runtime } from '@prisma/orm-postgres/family-runtime';
import { Collection, orm } from '@prisma/orm-postgres/orm-client';
import type { ExecutionContext } from '@prisma/orm-postgres/relational-core/query-lane-context';
import { websearchToTsquery } from '@prisma/orm-postgres/target/full-text';
import { expectTypeOf, test } from 'vitest';
import { createOrmClient } from '../src/orm-client/client';
import type { Contract } from '../src/prisma/contract.d';

declare const runtime: Runtime;
declare const context: ExecutionContext<Contract>;

const db = createOrmClient(runtime);
const plain = orm({ runtime, context }).public;
const q = websearchToTsquery('zebra');

export class SearchPosts extends Collection<Contract, 'Post'> {
  search() {
    return this.where((_p, { fns, indexes }) => fns.fullTextMatches(indexes.post_title_search, q));
  }
}

const use1 = db.Post.where((_p, { fns, indexes }) =>
  fns.fullTextMatches(indexes.post_title_search, q),
);
const use2 = db.Post.orderBy((_p, { fns, indexes }) =>
  fns.fullTextRank(indexes.post_title_search, q).desc(),
);
const use3 = plain.Post.select('id')
  .limit(3)
  .where((_p, { fns, indexes }) => fns.fullTextMatches(indexes.post_title_search, q));
const use4 = plain.User.include('posts', (posts) =>
  posts.where((_p, { fns, indexes }) => fns.fullTextMatches(indexes.post_title_search, q)),
);
const use5 = plain.User.where((u) =>
  u.posts.some((_p, { fns, indexes }) => fns.fullTextMatches(indexes.post_title_search, q)),
);
const use6 = plain.Post.fragment((posts) =>
  posts.orderBy((_p, { fns, indexes }) => fns.fullTextRank(indexes.post_title_search, q).desc()),
);
const use7 = SearchPosts;
const use8 = plain.Post.first((_p, { fns, indexes }) =>
  fns.fullTextMatches(indexes.post_title_search, q),
);
const use9 = plain.User.where((u, { fns }) => fns.eq(u.email, u.displayName));
const use10 = plain.Post.orderBy([
  (_p, { fns, indexes }) => fns.fullTextRank(indexes.post_title_search, q).desc(),
  (p) => p.id.asc(),
]);

test('ten uses of the second callback argument, one per site, type-check', () => {
  expectTypeOf([use1, use2, use3, use4, use5, use6, use7, use8, use9, use10]).not.toBeAny();
});
