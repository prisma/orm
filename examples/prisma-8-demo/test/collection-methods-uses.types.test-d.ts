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
    return this.using.post_search(q);
  }
}

export const use1 = plain.Post.using.post_search(q);
export const use2 = db.Post.using.post_search(q);
export const use3 = plain.Post.where({ title: 'a' }).using.post_search(q);
export const use4 = plain.Post.limit(3).using.post_title_search(q);
export const use5 = plain.Post.select('id').using.post_search(q);
export const use6 = plain.User.include('posts', (posts) => posts.using.post_search(q));
export const use7 = SearchPosts;
export const use8 = plain.Post.orderBy((p) => p.id.asc()).using.post_search(q);
export const use9 = plain.Post.with((posts) => posts.using.post_title_search(q));
export const use10 = db.Post.forUser('u').using.post_search(q).newestFirst();

test('ten uses of a contributed method, one per site, type-check', () => {
  expectTypeOf(use1).not.toBeAny();
  expectTypeOf(use10).not.toBeAny();
});
