// Integration coverage for M:N include (User -> tags via user_tags junction).
//
// `User.tags` is a many-to-many relation to `Tag` through the `user_tags`
// junction table. The read path compiles a correlated junction subquery that
// resolves each user's tags in a single SQL execution. These tests prove the
// end-to-end behaviour against a real database.
//
// Test data shape:
//
//   User(id, name, email, invitedById?)
//     tags: N:M Tag through user_tags (via user_id / tag_id)
//
//   Tag(id: text, name: text)
//
//   UserTag(userId, tagId) — junction
//
// Standard (from project integration-test standard):
//   1. Whole-row assertions via toEqual on every test.
//   2. Explicit .select() used in most tests.
//   3. At least one implicit/default-selection test (no .select()).

import { describe, expect, it } from 'vitest';
import { includeStrategies } from './helpers';
import {
  createUsersCollection,
  expectPerRelationStatements,
  timeouts,
  withCollectionRuntime,
} from './integration-helpers';
import { seedTags, seedUsers, seedUserTags } from './runtime-helpers';

// Tag IDs are text at the DB level (sql/char@1 at contract level).
const TAG_RUST = 'tag-rust';
const TAG_TS = 'tag-typescript';
const TAG_DB = 'tag-database';

describe.each(includeStrategies)('integration/mn-include (%s)', (strategy) => {
  // ===========================================================================
  // Core M:N include via junction: whole-row correctness.
  // ===========================================================================

  it(
    'include("tags") with explicit select returns selected fields on user and tags (whole-row toEqual)',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime, strategy);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
        ]);
        await seedTags(runtime, [
          { id: TAG_RUST, name: 'Rust' },
          { id: TAG_TS, name: 'TypeScript' },
        ]);
        await seedUserTags(runtime, [
          { userId: 1, tagId: TAG_RUST },
          { userId: 1, tagId: TAG_TS },
          { userId: 2, tagId: TAG_TS },
        ]);

        runtime.resetExecutions();
        const rows = await users
          .select('id', 'name')
          .orderBy((u) => u.id.asc())
          .include('tags', (tags) => tags.select('id', 'name').orderBy((t) => t.name.asc()))
          .all();
        expectPerRelationStatements(runtime, strategy, 2);

        expect(rows).toEqual([
          {
            id: 1,
            name: 'Alice',
            tags: [
              { id: TAG_RUST, name: 'Rust' },
              { id: TAG_TS, name: 'TypeScript' },
            ],
          },
          {
            id: 2,
            name: 'Bob',
            tags: [{ id: TAG_TS, name: 'TypeScript' }],
          },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'include("tags") resolves in one statement, or one per relation',
    async () => {
      // The M:N correlated subquery through the junction must lower to a
      // single SQL execution — that is the only non-functional invariant worth
      // asserting here.
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime, strategy);

        await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
        await seedTags(runtime, [{ id: TAG_TS, name: 'TypeScript' }]);
        await seedUserTags(runtime, [{ userId: 1, tagId: TAG_TS }]);

        runtime.resetExecutions();
        const rows = await users
          .select('id', 'name')
          .include('tags', (tags) => tags.select('id', 'name'))
          .all();

        expect(rows).toEqual([
          { id: 1, name: 'Alice', tags: [{ id: TAG_TS, name: 'TypeScript' }] },
        ]);
        expect(runtime.executions).toHaveLength(strategy === 'join' ? 1 : 2);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'user with no tags returns tags: []',
    async () => {
      // Edge case: a user with no junction rows must yield an empty array,
      // not null or undefined.
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime, strategy);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
        ]);
        await seedTags(runtime, [{ id: TAG_RUST, name: 'Rust' }]);
        // Only Alice has a tag; Bob has none.
        await seedUserTags(runtime, [{ userId: 1, tagId: TAG_RUST }]);

        runtime.resetExecutions();
        const rows = await users
          .select('id', 'name')
          .orderBy((u) => u.id.asc())
          .include('tags', (tags) => tags.select('id', 'name'))
          .all();
        expectPerRelationStatements(runtime, strategy, 2);

        expect(rows).toEqual([
          { id: 1, name: 'Alice', tags: [{ id: TAG_RUST, name: 'Rust' }] },
          { id: 2, name: 'Bob', tags: [] },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'a tag connected to multiple users resolves correctly for each user',
    async () => {
      // A shared tag must appear in every user's tags array independently.
      // A bug that deduplicated tags globally (e.g. keyed by tag ID across
      // all users) would drop the tag from some users' result.
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime, strategy);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
          { id: 3, name: 'Cara', email: 'cara@example.com' },
        ]);
        await seedTags(runtime, [
          { id: TAG_TS, name: 'TypeScript' },
          { id: TAG_DB, name: 'Database' },
        ]);
        // TypeScript is shared by Alice and Cara; Bob has only Database.
        await seedUserTags(runtime, [
          { userId: 1, tagId: TAG_TS },
          { userId: 2, tagId: TAG_DB },
          { userId: 3, tagId: TAG_TS },
        ]);

        runtime.resetExecutions();
        const rows = await users
          .select('id', 'name')
          .orderBy((u) => u.id.asc())
          .include('tags', (tags) => tags.select('id', 'name').orderBy((t) => t.name.asc()))
          .all();
        expectPerRelationStatements(runtime, strategy, 2);

        expect(rows).toEqual([
          { id: 1, name: 'Alice', tags: [{ id: TAG_TS, name: 'TypeScript' }] },
          { id: 2, name: 'Bob', tags: [{ id: TAG_DB, name: 'Database' }] },
          { id: 3, name: 'Cara', tags: [{ id: TAG_TS, name: 'TypeScript' }] },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'include("tags") with no .select returns the full default row shape (implicit selection)',
    async () => {
      // Standard requirement: at least one test with no .select so the
      // full default shape for User + tags: Tag[] is asserted.
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime, strategy);

        await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
        await seedTags(runtime, [
          { id: TAG_RUST, name: 'Rust' },
          { id: TAG_TS, name: 'TypeScript' },
        ]);
        await seedUserTags(runtime, [
          { userId: 1, tagId: TAG_RUST },
          { userId: 1, tagId: TAG_TS },
        ]);

        runtime.resetExecutions();
        const rows = await users
          .orderBy((u) => u.id.asc())
          .include('tags', (tags) => tags.orderBy((t) => t.name.asc()))
          .all();
        expectPerRelationStatements(runtime, strategy, 2);

        // Full User shape + tags: Tag[] (all Tag fields).
        expect(rows).toEqual([
          {
            id: 1,
            name: 'Alice',
            email: 'alice@example.com',
            invitedById: null,
            address: null,
            tags: [
              { id: TAG_RUST, name: 'Rust' },
              { id: TAG_TS, name: 'TypeScript' },
            ],
          },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  // ===========================================================================
  // Depth-2: M:N include nested under a 1:N (invitedUsers -> tags).
  // Proves the junction walk composes when the parent row comes from a
  // depth-1 include rather than the root collection.
  // ===========================================================================

  it(
    'depth-2: M:N tags nested under 1:N invitedUsers resolves in one statement, or one per relation',
    async () => {
      // users -> invitedUsers (1:N self-relation) -> tags (N:M via junction).
      // The M:N subquery at depth 2 must still correlate correctly to the
      // depth-1 invitedUsers alias and resolve in one statement, or one per relation.
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime, strategy);

        await seedUsers(runtime, [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com', invitedById: 1 },
          { id: 3, name: 'Cara', email: 'cara@example.com', invitedById: 1 },
        ]);
        await seedTags(runtime, [
          { id: TAG_RUST, name: 'Rust' },
          { id: TAG_TS, name: 'TypeScript' },
        ]);
        // Bob has Rust; Cara has TypeScript; Alice has no tags.
        await seedUserTags(runtime, [
          { userId: 2, tagId: TAG_RUST },
          { userId: 3, tagId: TAG_TS },
        ]);

        runtime.resetExecutions();
        const rows = await users
          .select('id', 'name')
          .where((u) => u.id.eq(1))
          .include('invitedUsers', (inv) =>
            inv
              .select('id', 'name')
              .orderBy((u) => u.id.asc())
              .include('tags', (tags) => tags.select('id', 'name').orderBy((t) => t.name.asc())),
          )
          .all();

        expect(rows).toEqual([
          {
            id: 1,
            name: 'Alice',
            invitedUsers: [
              { id: 2, name: 'Bob', tags: [{ id: TAG_RUST, name: 'Rust' }] },
              { id: 3, name: 'Cara', tags: [{ id: TAG_TS, name: 'TypeScript' }] },
            ],
          },
        ]);
        expect(runtime.executions).toHaveLength(strategy === 'join' ? 1 : 3);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'depth-2: sibling include("tags") and include("posts") on the same user resolves in one statement, or one per relation',
    async () => {
      // Two sibling top-level includes: tags (N:M) and posts (1:N). Both must
      // pack into a single SQL execution and resolve to independent correct shapes.
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime, strategy);

        await seedUsers(runtime, [{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
        await seedTags(runtime, [{ id: TAG_RUST, name: 'Rust' }]);
        await seedUserTags(runtime, [{ userId: 1, tagId: TAG_RUST }]);

        runtime.resetExecutions();
        const rows = await users
          .select('id', 'name')
          .include('tags', (tags) => tags.select('id', 'name'))
          .include('posts', (posts) => posts.select('id', 'title').orderBy((p) => p.id.asc()))
          .all();

        expect(rows).toEqual([
          { id: 1, name: 'Alice', tags: [{ id: TAG_RUST, name: 'Rust' }], posts: [] },
        ]);
        expect(runtime.executions).toHaveLength(strategy === 'join' ? 1 : 3);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
