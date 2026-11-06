/**
 * End-to-end ORM-client coverage for the async-codec read/write boundary.
 *
 * `Post.embedding` flows through the `pg/vector@1` codec from `@internal/extension-pgvector`. The pgvector codec's `encode` and `decode` are authored synchronously, but the codec base in `framework-components` lifts them to Promise-returning at the boundary, so this column exercises the runtime's async dispatch path on every read and write.
 *
 * `User.address` flows through `pg/jsonb@1` (a built-in `adapter-postgres` codec, also lifted to async by the same boundary). Adding a second codec with a different wire shape gives us "mixed sync/async codec columns" in a single integration run.
 *
 * The tests below verify:
 *
 * - **Read paths**: `.first()` and `for await (const row of c.all())` yield rows whose codec-decoded fields are plain `T` (not `Promise<T>`) and whose values round-trip through the runtime decode boundary.
 * - **Write paths**: `create()` and `update()` accept plain `T` for async-codec columns, run the value through the runtime's async encode path, and persist the wire format the codec produced (not a stringified Promise).
 */

import { describe, expect, it } from 'vitest';
import {
  createPostsCollection,
  createReturningPostsCollection,
  createReturningUsersCollection,
  createUsersCollection,
  timeouts,
  withCollectionRuntime,
} from './integration-helpers';
import { seedPosts, seedUsers } from './runtime-helpers';

describe('integration/codec-async', () => {
  it(
    'first() resolves a row with plain values for vector and jsonb async-codec columns',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await seedUsers(runtime, [{ id: 1, name: 'Author', email: 'author@example.com' }]);
        await runtime.query('update users set address = $1::jsonb where id = $2', [
          JSON.stringify({ street: '1 Way', city: 'Berlin', zip: null }),
          1,
        ]);
        await seedPosts(runtime, [
          { id: 1, title: 'Hello', userId: 1, views: 0, embedding: [0.1, 0.2, 0.3] },
        ]);

        const posts = createPostsCollection(runtime);
        const post = await posts.first({ id: 1 });
        expect(post).not.toBeNull();
        expect(post?.embedding).toEqual([0.1, 0.2, 0.3]);
        expect(Array.isArray(post?.embedding)).toBe(true);
        expect(post?.embedding).not.toBeInstanceOf(Promise);

        const users = createUsersCollection(runtime);
        const user = await users.first({ id: 1 });
        expect(user).not.toBeNull();
        expect(user?.address).toEqual({ street: '1 Way', city: 'Berlin', zip: null });
        expect(user?.address).not.toBeInstanceOf(Promise);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'for-await streaming yields rows with plain values for the vector async-codec column',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await seedUsers(runtime, [{ id: 1, name: 'A', email: 'a@example.com' }]);
        await seedPosts(runtime, [
          { id: 1, title: 'First', userId: 1, views: 0, embedding: [0.1, 0.2, 0.3] },
          { id: 2, title: 'Second', userId: 1, views: 0, embedding: [0.3, 0.4, 0.5] },
        ]);

        const posts = createPostsCollection(runtime);
        const collected: { id: number; embedding: number[] | null }[] = [];

        for await (const row of posts.orderBy((post) => post.id.asc()).all()) {
          collected.push({ id: row.id, embedding: row.embedding });
          expect(row.embedding).not.toBeInstanceOf(Promise);
        }

        expect(collected).toEqual([
          { id: 1, embedding: [0.1, 0.2, 0.3] },
          { id: 2, embedding: [0.3, 0.4, 0.5] },
        ]);
        expect(Array.isArray(collected[0]?.embedding)).toBe(true);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'create() accepts plain number[] for embedding and persists via the runtime async encode path',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await seedUsers(runtime, [{ id: 1, name: 'A', email: 'a@example.com' }]);

        const posts = createReturningPostsCollection(runtime);
        const created = await posts.create({
          id: 1,
          title: 'New',
          userId: 1,
          views: 0,
          embedding: [0.1, 0.2, 0.3],
        });

        expect(created.embedding).toEqual([0.1, 0.2, 0.3]);
        expect(Array.isArray(created.embedding)).toBe(true);

        const rows = await runtime.query<{ embedding: string }>(
          'select embedding::text as embedding from posts where id = $1',
          [1],
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]?.embedding).toBe('[0.1,0.2,0.3]');
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'create() accepts plain object for jsonb-backed value-object field and persists JSON',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);
        const created = await users.create({
          id: 7,
          name: 'Eve',
          email: 'eve@example.com',
          invitedById: null,
          address: { street: '42 Wallaby Way', city: 'Sydney', zip: '2000' },
        });

        expect(created.address).toEqual({
          street: '42 Wallaby Way',
          city: 'Sydney',
          zip: '2000',
        });

        const rows = await runtime.query<{ address: unknown }>(
          'select address from users where id = $1',
          [7],
        );
        expect(rows[0]?.address).toEqual({
          street: '42 Wallaby Way',
          city: 'Sydney',
          zip: '2000',
        });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'update() accepts plain number[] for embedding and re-encodes via the runtime async path',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        await seedUsers(runtime, [{ id: 1, name: 'A', email: 'a@example.com' }]);
        await seedPosts(runtime, [
          { id: 1, title: 'Hello', userId: 1, views: 0, embedding: [0.1, 0.2, 0.3] },
        ]);

        const posts = createReturningPostsCollection(runtime);
        const updated = await posts.where({ id: 1 }).update({ embedding: [0.4, 0.5, 0.6] });
        expect(updated).not.toBeNull();
        expect(updated?.embedding).toEqual([0.4, 0.5, 0.6]);

        const rows = await runtime.query<{ embedding: string }>(
          'select embedding::text as embedding from posts where id = $1',
          [1],
        );
        expect(rows[0]?.embedding).toBe('[0.4,0.5,0.6]');
      });
    },
    timeouts.spinUpPpgDev,
  );
});
