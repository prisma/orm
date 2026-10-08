import type { Runtime } from '@prisma/orm-postgres/family-runtime';
import {
  type Filtered,
  type Ordered,
  orm,
  type QueryFragment,
  type UniquelyFiltered,
} from '@prisma/orm-postgres/orm-client';
import type { ExecutionContext } from '@prisma/orm-postgres/relational-core/query-lane-context';
import { expectTypeOf, test } from 'vitest';
import { createOrmClient } from '../src/orm-client/client';
import type { PostCollection, UserCollection } from '../src/orm-client/collections';
import type { Contract } from '../src/prisma/contract.d';
import { db as demoDb } from '../src/prisma/db';

declare const runtime: Runtime;
declare const search: string | undefined;

const db = createOrmClient(runtime);
const plain = orm({ runtime, context: demoDb.context as ExecutionContext<Contract> }).public;

export const classChain = db.User.admins().newestFirst().limit(10);
export const classChainAfterInclude = db.User.include('posts').admins();
export const plainChain = plain.User.where({ kind: 'admin' }).orderBy((u) => u.createdAt.desc());
export const plainInclude = plain.Post.include('user').include('tags');
export const titled: QueryFragment<PostCollection, Filtered<PostCollection>> = (posts) =>
  posts.withTitle('x');
export const plainUnique = plain.User.whereUnique({ id: 'u1' });
export const classUnique = db.User.whereUnique({ id: 'u1' }).admins();
export const uniqueThenWhere = plain.User.whereUnique({ id: 'u1' }).where({ kind: 'admin' });
export const classUniqueThenWhere = db.Post.whereUnique({ id: 'p1' }).forUser('u1');
export const uniqueInclude = plain.Post.whereUnique({ id: 'p1' }).include('user');
export const classUniqueInclude = db.Post.whereUnique({ id: 'p1' }).include('user');
export const uniquePrepared = plain.User.whereUnique({ id: 'u1' }).prepared;
export const classUniquePrepared = db.User.whereUnique({ id: 'u1' }).prepared;

test('class methods chain with each other and with the built-in methods', () => {
  expectTypeOf(db.User.admins().newestFirst().emailDomain('x.io')).toEqualTypeOf<
    Filtered<Ordered<UserCollection>>
  >();
  expectTypeOf(db.Post.forUser('u1').withTitle('t').newestFirst().limit(5)).toEqualTypeOf<
    Filtered<Ordered<PostCollection>>
  >();
  expectTypeOf(db.Post.with(titled).newestFirst()).toEqualTypeOf<
    Filtered<Ordered<PostCollection>>
  >();
});

test('class methods chain after include and keep the included rows', async () => {
  const posts = db.Post.include('user').forUser('u1').include('tags').newestFirst();
  const post = await posts.first();
  expectTypeOf(post!.user.email).toEqualTypeOf<string>();
  expectTypeOf(post!.tags).toEqualTypeOf<{ id: string; label: string }[]>();
});

test('a conditional filter refuses deletes', () => {
  const posts = search ? db.Post.withTitle(search) : db.Post;
  expectTypeOf(posts).toEqualTypeOf<PostCollection>();
  // @ts-expect-error the collection may have no filter
  posts.deleteAll();
});

test('a uniquely filtered chain keeps the class and refuses many-record calls', async () => {
  expectTypeOf(classUnique).toEqualTypeOf<UniquelyFiltered<UserCollection>>();
  expectTypeOf(classUniqueThenWhere).toEqualTypeOf<UniquelyFiltered<PostCollection>>();
  const post = await classUniqueInclude.first();
  expectTypeOf(post!.user.email).toEqualTypeOf<string>();
  expectTypeOf(uniquePrepared.first()).not.toBeAny();
  // @ts-expect-error a uniquely filtered collection has at most one record
  classUnique.all();
  // @ts-expect-error a uniquely filtered collection has at most one record
  uniqueThenWhere.limit(1);
  // @ts-expect-error a uniquely filtered collection has at most one record
  uniquePrepared.all();
});
