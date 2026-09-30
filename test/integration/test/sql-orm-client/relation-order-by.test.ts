// Integration coverage for ordering a collection by a relation.
//
// `orderBy` can order by a to-one relation's column (a correlated scalar
// subquery), by a to-many relation's row count, optionally filtered (a
// correlated `count(*)` subquery, through the junction for N:M), and can place
// nulls first or last. These tests run each form on a real database.
//
// Seed data (chosen so no ordering below coincides with id order):
//
//   User  inviter        posts (views)        tags
//   1     Alice  —            1 (100)              Rust
//   2     Zoe    Alice        3 (10, 20, 30)       TypeScript, Database
//   3     Cara   Zoe          0                    Rust, TypeScript, Database
//   4     Bob    Alice        2 (60, 70)           —

import { describe, expect, it } from 'vitest';
import {
  createPostsCollection,
  createUsersCollection,
  timeouts,
  withCollectionRuntime,
} from './integration-helpers';
import type { PgIntegrationRuntime } from './runtime-helpers';
import { seedComments, seedPosts, seedTags, seedUsers, seedUserTags } from './runtime-helpers';

const ALICE = { id: 1, name: 'Alice' };
const ZOE = { id: 2, name: 'Zoe' };
const CARA = { id: 3, name: 'Cara' };
const BOB = { id: 4, name: 'Bob' };

async function seed(runtime: PgIntegrationRuntime): Promise<void> {
  await seedUsers(runtime, [
    { ...ALICE, email: 'alice@example.com' },
    { ...ZOE, email: 'zoe@example.com', invitedById: ALICE.id },
    { ...CARA, email: 'cara@example.com', invitedById: ZOE.id },
    { ...BOB, email: 'bob@example.com', invitedById: ALICE.id },
  ]);
  await seedPosts(runtime, [
    { id: 1, title: 'a1', userId: ALICE.id, views: 100 },
    { id: 2, title: 'z1', userId: ZOE.id, views: 10 },
    { id: 3, title: 'z2', userId: ZOE.id, views: 20 },
    { id: 4, title: 'z3', userId: ZOE.id, views: 30 },
    { id: 5, title: 'b1', userId: BOB.id, views: 60 },
    { id: 6, title: 'b2', userId: BOB.id, views: 70 },
  ]);
  await seedTags(runtime, [
    { id: 'tag-rust', name: 'Rust' },
    { id: 'tag-ts', name: 'TypeScript' },
    { id: 'tag-db', name: 'Database' },
  ]);
  await seedUserTags(runtime, [
    { userId: ALICE.id, tagId: 'tag-rust' },
    { userId: ZOE.id, tagId: 'tag-ts' },
    { userId: ZOE.id, tagId: 'tag-db' },
    { userId: CARA.id, tagId: 'tag-rust' },
    { userId: CARA.id, tagId: 'tag-ts' },
    { userId: CARA.id, tagId: 'tag-db' },
  ]);
}

describe('integration/relation-order-by', () => {
  // Proves a to-many count orders parents by how many related rows each has,
  // in both directions, with id as the tie-break.
  it(
    'orders by a to-many relation count ascending and descending',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await seed(runtime);
        const users = createUsersCollection(runtime).select('id', 'name');

        const ascending = await users
          .orderBy([(u) => u.posts.count().asc(), (u) => u.id.asc()])
          .all();
        const descending = await users
          .orderBy([(u) => u.posts.count().desc(), (u) => u.id.asc()])
          .all();

        expect(ascending).toEqual([CARA, ALICE, BOB, ZOE]);
        expect(descending).toEqual([ZOE, BOB, ALICE, CARA]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  // Proves the count predicate is applied: counting only posts with more than
  // 50 views gives a different order from the unfiltered count.
  it(
    'orders by a filtered to-many count',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await seed(runtime);
        const users = createUsersCollection(runtime).select('id', 'name');

        const rows = await users
          .orderBy([(u) => u.posts.count((p) => p.views.gt(50)).desc(), (u) => u.id.asc()])
          .all();

        expect(rows).toEqual([BOB, ALICE, ZOE, CARA]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  // Proves a to-one column orders by the related row's value, and that a
  // missing related row (null foreign key) takes Postgres's default null
  // placement: last when ascending, first when descending.
  it(
    'orders by a to-one relation column with default null placement',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await seed(runtime);
        const users = createUsersCollection(runtime).select('id', 'name');

        const ascending = await users
          .orderBy([(u) => u.invitedBy.name.asc(), (u) => u.id.asc()])
          .all();
        const descending = await users
          .orderBy([(u) => u.invitedBy.name.desc(), (u) => u.id.asc()])
          .all();

        expect(ascending).toEqual([ZOE, BOB, CARA, ALICE]);
        expect(descending).toEqual([ALICE, CARA, ZOE, BOB]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  // Proves nulls: 'last' on a to-one column overrides the default placement:
  // the user with no inviter is last in both directions.
  it(
    'places a missing to-one row last in both directions with nulls last',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await seed(runtime);
        const users = createUsersCollection(runtime).select('id', 'name');

        const ascending = await users
          .orderBy([(u) => u.invitedBy.name.asc({ nulls: 'last' }), (u) => u.id.asc()])
          .all();
        const descending = await users
          .orderBy([(u) => u.invitedBy.name.desc({ nulls: 'last' }), (u) => u.id.asc()])
          .all();

        expect(ascending).toEqual([ZOE, BOB, CARA, ALICE]);
        expect(descending).toEqual([CARA, ZOE, BOB, ALICE]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  // Proves an N:M count goes through the junction table, unfiltered and with
  // a predicate on the related model.
  it(
    'orders by an N:M relation count through the junction',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await seed(runtime);
        const users = createUsersCollection(runtime).select('id', 'name');

        const byTagCount = await users
          .orderBy([(u) => u.tags.count().desc(), (u) => u.id.asc()])
          .all();
        const byRustCount = await users
          .orderBy([(u) => u.tags.count((t) => t.name.eq('Rust')).desc(), (u) => u.id.asc()])
          .all();

        expect(byTagCount).toEqual([CARA, ZOE, ALICE, BOB]);
        expect(byRustCount).toEqual([ALICE, CARA, ZOE, BOB]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  // Proves limit and offset slice the rows after the relation order applies.
  it(
    'applies limit and offset after a relation count order',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await seed(runtime);
        const users = createUsersCollection(runtime).select('id', 'name');

        const rows = await users
          .orderBy([(u) => u.posts.count().desc(), (u) => u.id.asc()])
          .limit(2)
          .offset(1)
          .all();

        expect(rows).toEqual([BOB, ALICE]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  // Proves nulls placement on a scalar column of the base table reaches the
  // database: ascending would otherwise put the null invitedById last.
  it(
    'places nulls first on a nullable scalar column',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await seed(runtime);
        const users = createUsersCollection(runtime).select('id', 'name');

        const rows = await users
          .orderBy([(u) => u.invitedById.asc({ nulls: 'first' }), (u) => u.id.asc()])
          .all();

        expect(rows).toEqual([ALICE, ZOE, BOB, CARA]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  // Proves an aggregate over distinct rows keeps a relation order: distinct
  // keeps each title's post by the first author name, the page keeps the
  // first such post, and the sum reads it. Ordering by id instead would keep
  // posts 1 and 3: the unpaged sum would be 15 and the first page 10.
  it(
    'aggregates distinct rows paged by a to-one relation order',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await seedUsers(runtime, [
          { ...ALICE, email: 'alice@example.com' },
          { ...ZOE, email: 'zoe@example.com' },
          { ...CARA, email: 'cara@example.com' },
          { ...BOB, email: 'bob@example.com' },
        ]);
        await seedPosts(runtime, [
          { id: 1, title: 'x', userId: ZOE.id, views: 10 },
          { id: 2, title: 'x', userId: ALICE.id, views: 100 },
          { id: 3, title: 'y', userId: CARA.id, views: 5 },
          { id: 4, title: 'y', userId: BOB.id, views: 60 },
        ]);
        const posts = createPostsCollection(runtime);

        const all = await posts
          .orderBy((p) => p.author.name.asc())
          .distinct('title')
          .aggregate((aggregate) => ({ totalViews: aggregate.sum('views') }));
        const firstPage = await posts
          .orderBy((p) => p.author.name.asc())
          .distinct('title')
          .limit(1)
          .aggregate((aggregate) => ({ totalViews: aggregate.sum('views') }));

        expect(all).toEqual({ totalViews: 160 });
        expect(firstPage).toEqual({ totalViews: 100 });
      });
    },
    timeouts.spinUpPpgDev,
  );

  // Proves a relation order inside a self-relation include correlates with the
  // aliased child rows: Alice's invited users come back by their own post
  // counts (Bob 2, Zoe 3), not by id; and ordering them by their inviter's name
  // (the same inviter for every child, so id decides) runs against the
  // aliased inner table.
  it(
    'orders a self-relation include by a relation count and by a to-one column',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await seed(runtime);
        const users = createUsersCollection(runtime).select('id', 'name');

        const byPostCount = await users
          .where((u) => u.id.eq(ALICE.id))
          .include('invitedUsers', (invited) =>
            invited.select('id', 'name').orderBy([(u) => u.posts.count().asc(), (u) => u.id.asc()]),
          )
          .all();
        const byInviterName = await users
          .where((u) => u.id.eq(ALICE.id))
          .include('invitedUsers', (invited) =>
            invited
              .select('id', 'name')
              .orderBy([(u) => u.invitedBy.name.asc(), (u) => u.id.desc()]),
          )
          .all();

        expect(byPostCount).toEqual([{ ...ALICE, invitedUsers: [BOB, ZOE] }]);
        expect(byInviterName).toEqual([{ ...ALICE, invitedUsers: [BOB, ZOE] }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  // Proves a filtered count order inside an include binds its parameter:
  // Zoe's posts ordered by how many 'ok' comments each has differ from both id
  // order and the unfiltered comment count.
  it(
    'orders an include by a filtered to-many count',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await seed(runtime);
        await seedComments(runtime, [
          { id: 1, body: 'ok', postId: 2 },
          { id: 2, body: 'ok', postId: 2 },
          { id: 3, body: 'spam', postId: 3 },
          { id: 4, body: 'spam', postId: 3 },
          { id: 5, body: 'spam', postId: 3 },
          { id: 6, body: 'ok', postId: 4 },
        ]);
        const users = createUsersCollection(runtime).select('id', 'name');

        const rows = await users
          .where((u) => u.id.eq(ZOE.id))
          .include('posts', (posts) =>
            posts
              .select('id')
              .orderBy([(p) => p.comments.count((c) => c.body.eq('ok')).desc(), (p) => p.id.asc()]),
          )
          .all();

        expect(rows).toEqual([{ ...ZOE, posts: [{ id: 2 }, { id: 4 }, { id: 3 }] }]);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
