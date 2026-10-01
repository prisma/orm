import { DefaultValueExpr, InsertAst, ParamRef } from '@internal/sql-relational-core/ast';
import type { Char } from '@internal/target-postgres/codec-types';
import { describe, expect, it } from 'vitest';
import {
  createReturningTagsCollection,
  createReturningUsersCollection,
  createUsersCollection,
  createUsersCollectionWithoutReturning,
  timeouts,
  withCollectionRuntime,
} from './integration-helpers';
import { seedPosts } from './runtime-helpers';

function expectInsertBatchAst(
  ast: unknown,
  rows: ReadonlyArray<{
    id: number;
    name: string;
    email: string;
    invitedById: null | undefined;
  }>,
): asserts ast is InsertAst {
  expect(ast).toBeInstanceOf(InsertAst);

  expect((ast as InsertAst).rows).toEqual([
    {
      id: ParamRef.of(rows[0]!.id, { name: 'id', codec: { codecId: 'pg/int4@1' } }),
      name: ParamRef.of(rows[0]!.name, {
        name: 'name',
        codec: { codecId: 'pg/text@1' },
      }),
      email: ParamRef.of(rows[0]!.email, {
        name: 'email',
        codec: { codecId: 'pg/text@1' },
      }),
      invited_by_id: ParamRef.of(rows[0]!.invitedById ?? null, {
        name: 'invited_by_id',
        codec: { codecId: 'pg/int4@1' },
      }),
    },
    {
      id: ParamRef.of(rows[1]!.id, { name: 'id', codec: { codecId: 'pg/int4@1' } }),
      name: ParamRef.of(rows[1]!.name, {
        name: 'name',
        codec: { codecId: 'pg/text@1' },
      }),
      email: ParamRef.of(rows[1]!.email, {
        name: 'email',
        codec: { codecId: 'pg/text@1' },
      }),
      invited_by_id:
        rows[1]!.invitedById === undefined
          ? new DefaultValueExpr()
          : ParamRef.of(rows[1]!.invitedById, {
              name: 'invited_by_id',
              codec: { codecId: 'pg/int4@1' },
            }),
    },
  ]);
}

describe('integration/create', () => {
  it(
    'create() returns inserted row when returning capability is enabled',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        const created = await users.create({
          id: 9,
          name: 'Neo',
          email: 'neo@example.com',
          invitedById: null,
        });
        expect(created).toEqual({
          id: 9,
          name: 'Neo',
          email: 'neo@example.com',
          invitedById: null,
          address: null,
        });

        const rows = await runtime.query<{ id: number; name: string }>(
          'select id, name from users where id = $1',
          [9],
        );
        expect(rows).toEqual([{ id: 9, name: 'Neo' }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'createAll() inserts multiple rows and returns inserted rows',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        runtime.resetExecutions();
        const created = await users.createAll([
          { id: 10, name: 'Alice', email: 'alice@example.com', invitedById: null },
          { id: 11, name: 'Bob', email: 'bob@example.com' },
        ]);

        expect(created).toEqual([
          { id: 10, name: 'Alice', email: 'alice@example.com', invitedById: null, address: null },
          { id: 11, name: 'Bob', email: 'bob@example.com', invitedById: null, address: null },
        ]);
        expect(runtime.executions).toHaveLength(1);
        expectInsertBatchAst(runtime.executions[0]?.ast, [
          { id: 10, name: 'Alice', email: 'alice@example.com', invitedById: null },
          { id: 11, name: 'Bob', email: 'bob@example.com', invitedById: undefined },
        ]);

        const rows = await runtime.query<{ id: number; name: string; email: string }>(
          'select id, name, email from users order by id',
        );
        expect(rows).toEqual([
          { id: 10, name: 'Alice', email: 'alice@example.com' },
          { id: 11, name: 'Bob', email: 'bob@example.com' },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'createAll() with include() returns inserted rows with their relations via a single read-back',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        runtime.resetExecutions();
        const created = await users
          .include('posts', (posts) => posts.orderBy((post) => post.id.asc()))
          .createAll([
            { id: 10, name: 'Alice', email: 'alice@example.com', invitedById: null },
            { id: 11, name: 'Bob', email: 'bob@example.com', invitedById: null },
          ]);

        // Freshly inserted users own no posts yet; the read-back still
        // resolves the relation to an empty array per row.
        expect(created).toEqual([
          {
            id: 10,
            name: 'Alice',
            email: 'alice@example.com',
            invitedById: null,
            address: null,
            posts: [],
          },
          {
            id: 11,
            name: 'Bob',
            email: 'bob@example.com',
            invitedById: null,
            address: null,
            posts: [],
          },
        ]);
        // One INSERT ... RETURNING plus one include read-back — no
        // per-relation N+1.
        expect(runtime.executions).toHaveLength(2);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'createAll() with include() resolves non-empty relations on the read-back',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        // posts.user_id has no FK, so relations can be seeded ahead of
        // the parents they point at — the include read-back then resolves
        // each inserted user to the posts that already reference it.
        await seedPosts(runtime, [
          { id: 10, title: 'Alice A', userId: 10, views: 100 },
          { id: 11, title: 'Bob A', userId: 11, views: 200 },
          { id: 12, title: 'Bob B', userId: 11, views: 300 },
        ]);

        const created = await users
          .include('posts', (posts) => posts.orderBy((post) => post.id.asc()))
          .createAll([
            { id: 10, name: 'Alice', email: 'alice@example.com', invitedById: null },
            { id: 11, name: 'Bob', email: 'bob@example.com', invitedById: null },
          ]);

        const sorted = [...created].sort((a, b) => a.id - b.id);
        expect(sorted).toEqual([
          {
            id: 10,
            name: 'Alice',
            email: 'alice@example.com',
            invitedById: null,
            address: null,
            posts: [{ id: 10, title: 'Alice A', userId: 10, views: 100, embedding: null }],
          },
          {
            id: 11,
            name: 'Bob',
            email: 'bob@example.com',
            invitedById: null,
            address: null,
            posts: [
              { id: 11, title: 'Bob A', userId: 11, views: 200, embedding: null },
              { id: 12, title: 'Bob B', userId: 11, views: 300, embedding: null },
            ],
          },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'createAndCount() inserts multiple rows and returns inserted count',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        runtime.resetExecutions();
        const count = await users.createAndCount([
          { id: 20, name: 'Cara', email: 'cara@example.com', invitedById: null },
          { id: 21, name: 'Dan', email: 'dan@example.com' },
        ]);
        expect(count).toBe(2);
        expect(runtime.executions).toHaveLength(1);
        expectInsertBatchAst(runtime.executions[0]?.ast, [
          { id: 20, name: 'Cara', email: 'cara@example.com', invitedById: null },
          { id: 21, name: 'Dan', email: 'dan@example.com', invitedById: undefined },
        ]);

        const rows = await runtime.query<{ id: number; name: string }>(
          'select id, name from users order by id',
        );
        expect(rows).toEqual([
          { id: 20, name: 'Cara' },
          { id: 21, name: 'Dan' },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'createAndCount() returns the count the database reports, not the input length',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollection(runtime);

        try {
          await runtime.query(`
            create or replace function skip_flagged_user() returns trigger as $$
            begin
              if new.email = 'skipped@example.com' then
                return null;
              end if;
              return new;
            end;
            $$ language plpgsql
          `);
          await runtime.query(
            'create trigger users_skip_flagged before insert on users for each row execute function skip_flagged_user()',
          );

          const count = await users.createAndCount([
            { id: 40, name: 'Eve', email: 'eve@example.com', invitedById: null },
            { id: 41, name: 'Skipped', email: 'skipped@example.com', invitedById: null },
            { id: 42, name: 'Frank', email: 'frank@example.com', invitedById: null },
          ]);
          expect(count).toBe(2);

          const rows = await runtime.query<{ id: number; name: string }>(
            'select id, name from users order by id',
          );
          expect(rows).toEqual([
            { id: 40, name: 'Eve' },
            { id: 42, name: 'Frank' },
          ]);
        } finally {
          await runtime.query('drop trigger if exists users_skip_flagged on users');
          await runtime.query('drop function if exists skip_flagged_user()');
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'create() and createAll() reject when returning capability is disabled',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createUsersCollectionWithoutReturning(runtime);

        await expect(
          users.create({
            id: 30,
            name: 'NoReturn',
            email: 'noreturn@example.com',
            invitedById: null,
          }),
        ).rejects.toThrow(/requires contract capability "returning"/);

        expect(() =>
          users.createAll([
            {
              id: 31,
              name: 'NoReturn2',
              email: 'noreturn2@example.com',
              invitedById: null,
            },
          ]),
        ).toThrow(/requires contract capability "returning"/);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'createAll([]) is a no-op and executes nothing',
    async () => {
      await withCollectionRuntime(async (runtime) => {
        const users = createReturningUsersCollection(runtime);

        runtime.resetExecutions();
        const rows = await users.createAll([]);

        expect(rows).toEqual([]);
        expect(runtime.executions).toHaveLength(0);
      });
    },
    timeouts.spinUpPpgDev,
  );

  describe('execution mutation defaults', () => {
    it(
      'create() generates a default id when not provided',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          const tags = createReturningTagsCollection(runtime);

          const created = await tags.create({ name: 'typescript' });
          expect(created.id).toEqual(expect.any(String));
          expect(created.id.length).toBeGreaterThan(0);
          expect(created.name).toBe('typescript');

          const found = await tags.where({ name: 'typescript' }).first();
          expect(found).toEqual(created);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'create() preserves an explicitly provided id',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          const tags = createReturningTagsCollection(runtime);
          const customId = '123e4567-e89b-12d3-a456-426614174000' as Char<36>;

          const created = await tags.create({ id: customId, name: 'rust' });
          expect(created).toEqual({ id: customId, name: 'rust' });

          const found = await tags.where({ name: 'rust' }).first();
          expect(found).toEqual({ id: customId, name: 'rust' });
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'createAll() generates unique ids for each row',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          const tags = createReturningTagsCollection(runtime);

          const created = await tags.createAll([
            { name: 'go' },
            { name: 'python' },
            { name: 'java' },
          ]);

          expect(created).toHaveLength(3);
          const ids = created.map((t) => t.id);
          expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
          expect(new Set(ids).size).toBe(3);

          const all = await tags.orderBy((t) => t.name.asc()).all();
          expect(all).toHaveLength(3);
          expect(all.map((r) => r.name)).toEqual(['go', 'java', 'python']);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'createAndCount() generates ids for rows without returning them',
      async () => {
        await withCollectionRuntime(async (runtime) => {
          const tags = createReturningTagsCollection(runtime);

          const count = await tags.createAndCount([{ name: 'elixir' }, { name: 'haskell' }]);
          expect(count).toBe(2);

          const all = await tags.orderBy((t) => t.name.asc()).all();
          expect(all).toHaveLength(2);
          expect(all.every((r) => typeof r.id === 'string' && r.id.length > 0)).toBe(true);
        });
      },
      timeouts.spinUpPpgDev,
    );
  });
});
