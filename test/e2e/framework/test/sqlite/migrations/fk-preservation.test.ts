import { defineContract, model } from '@prisma/orm-sqlite/contract-builder';
import { describe, expect, it } from 'vitest';
import { applyMigration, int, text } from './harness';

describe('SQLite Migration E2E - FK preservation through recreate-table', () => {
  const WIDENING = { allowedOperationClasses: ['additive', 'widening'] } as const;

  it('preserves FK when the child table (holder of the FK) is recreated', async () => {
    const User = model('User', { fields: { id: int.id(), name: text } });
    const PostV1 = model('Post', {
      fields: {
        id: int.id(),
        title: text,
        bio: text,
        authorId: int.column('author_id'),
      },
    }).sql((ctx) => ({
      foreignKeys: [
        ctx.constraints.foreignKey(ctx.cols.authorId, ctx.constraints.ref('User', 'id'), {
          onDelete: 'cascade',
          index: true,
        }),
      ],
    }));
    const PostV2 = model('Post', {
      fields: {
        id: int.id(),
        title: text,
        bio: text.optional(),
        authorId: int.column('author_id'),
      },
    }).sql((ctx) => ({
      foreignKeys: [
        ctx.constraints.foreignKey(ctx.cols.authorId, ctx.constraints.ref('User', 'id'), {
          onDelete: 'cascade',
          index: true,
        }),
      ],
    }));

    await applyMigration(
      {
        origin: defineContract({ models: { User, Post: PostV1 } }),
        destination: defineContract({ models: { User, Post: PostV2 } }),
        policy: WIDENING,
        seed: async (driver) => {
          await driver.query('INSERT INTO "User" (id, name) VALUES (?, ?)', [1, 'Alice']);
          await driver.query('INSERT INTO "Post" (id, title, bio, author_id) VALUES (?, ?, ?, ?)', [
            1,
            'Post 1',
            'original bio',
            1,
          ]);
        },
      },
      async ({ driver, schema }) => {
        expect(schema.tables['Post']!.foreignKeys).toHaveLength(1);
        const fk = schema.tables['Post']!.foreignKeys[0]!;
        expect([...fk.columns]).toEqual(['author_id']);
        expect(fk.referencedTable).toBe('User');
        expect([...fk.referencedColumns]).toEqual(['id']);
        expect(fk.onDelete).toBe('cascade');

        const rows = await driver.query<{ id: number; bio: string | null; author_id: number }>(
          'SELECT id, bio, author_id FROM "Post" WHERE id = ?',
          [1],
        );
        expect(rows.rows[0]).toMatchObject({ id: 1, bio: 'original bio', author_id: 1 });

        await expect(
          driver.query('INSERT INTO "Post" (id, title, author_id) VALUES (?, ?, ?)', [
            2,
            'Orphan',
            999,
          ]),
        ).rejects.toThrow();

        await driver.query('DELETE FROM "User" WHERE id = ?', [1]);
        expect((await driver.query('SELECT * FROM "Post"')).rows).toHaveLength(0);
      },
    );
  });

  it('preserves FK when the parent (referenced) table is recreated', async () => {
    const UserV1 = model('User', { fields: { id: int.id(), name: text, bio: text } });
    const UserV2 = model('User', {
      fields: { id: int.id(), name: text, bio: text.optional() },
    });
    const Post = model('Post', {
      fields: { id: int.id(), title: text, authorId: int.column('author_id') },
    }).sql((ctx) => ({
      foreignKeys: [
        ctx.constraints.foreignKey(ctx.cols.authorId, ctx.constraints.ref('User', 'id'), {
          onDelete: 'cascade',
          index: true,
        }),
      ],
    }));

    await applyMigration(
      {
        origin: defineContract({ models: { User: UserV1, Post } }),
        destination: defineContract({ models: { User: UserV2, Post } }),
        policy: WIDENING,
        seed: async (driver) => {
          await driver.query('INSERT INTO "User" (id, name, bio) VALUES (?, ?, ?)', [
            1,
            'Alice',
            'bio text',
          ]);
          await driver.query('INSERT INTO "Post" (id, title, author_id) VALUES (?, ?, ?)', [
            1,
            'Post 1',
            1,
          ]);
        },
      },
      async ({ driver }) => {
        const users = await driver.query<{ id: number; name: string }>(
          'SELECT id, name FROM "User"',
        );
        expect(users.rows).toHaveLength(1);
        expect(users.rows[0]).toMatchObject({ id: 1, name: 'Alice' });

        const posts = await driver.query<{ id: number; author_id: number }>(
          'SELECT id, author_id FROM "Post"',
        );
        expect(posts.rows).toHaveLength(1);
        expect(posts.rows[0]).toMatchObject({ id: 1, author_id: 1 });

        await expect(
          driver.query('INSERT INTO "Post" (id, title, author_id) VALUES (?, ?, ?)', [
            2,
            'Orphan',
            999,
          ]),
        ).rejects.toThrow();

        await driver.query('DELETE FROM "User" WHERE id = ?', [1]);
        expect((await driver.query('SELECT * FROM "Post"')).rows).toHaveLength(0);
      },
    );
  });

  it('preserves declared indexes when the table is recreated', async () => {
    const UserV1 = model('User', {
      fields: { id: int.id(), email: text, name: text },
    }).sql((ctx) => ({
      indexes: [
        ctx.constraints.index([ctx.cols.email], { name: 'idx_users_email' }),
        ctx.constraints.index([ctx.cols.name, ctx.cols.email], { name: 'idx_users_name_email' }),
      ],
    }));
    const UserV2 = model('User', {
      fields: { id: int.id(), email: text, name: text.optional() },
    }).sql((ctx) => ({
      indexes: [
        ctx.constraints.index([ctx.cols.email], { name: 'idx_users_email' }),
        ctx.constraints.index([ctx.cols.name, ctx.cols.email], { name: 'idx_users_name_email' }),
      ],
    }));

    await applyMigration(
      {
        origin: defineContract({ models: { User: UserV1 } }),
        destination: defineContract({ models: { User: UserV2 } }),
        policy: WIDENING,
        seed: async (driver) => {
          await driver.query('INSERT INTO "User" (id, email, name) VALUES (?, ?, ?)', [
            1,
            'alice@example.com',
            'Alice',
          ]);
        },
      },
      async ({ driver, schema, plannedOperationIds }) => {
        // UserV1 and UserV2 declare the same indexes, so this test only
        // proves "indexes survived" if the table was actually recreated.
        // Assert the planner emitted a recreate-table op so a future change
        // that suppresses recreate for nullability widening fails this test
        // instead of silently passing on the unchanged table.
        expect(plannedOperationIds).toContain('recreateTable.User');

        const indexCols = schema.tables['User']!.indexes.map((i) => [...(i.columns ?? [])]);
        expect(indexCols).toContainEqual(['email']);
        expect(indexCols).toContainEqual(['name', 'email']);

        const indexNames = (
          await driver.query<{ name: string }>(
            `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'User' AND name NOT LIKE 'sqlite_%'`,
          )
        ).rows.map((r) => r.name);
        expect(indexNames).toContain('idx_users_email_46df9cad');
        expect(indexNames).toContain('idx_users_name_email_0a1c9ab4');

        const rows = await driver.query<{ id: number; email: string; name: string | null }>(
          'SELECT id, email, name FROM "User" WHERE id = ?',
          [1],
        );
        expect(rows.rows[0]).toMatchObject({ id: 1, email: 'alice@example.com', name: 'Alice' });
      },
    );
  });

  it('preserves FKs in a multi-hop topology (Comment -> Post -> User) when the middle table is recreated', async () => {
    const User = model('User', { fields: { id: int.id(), name: text } });
    const PostV1 = model('Post', {
      fields: {
        id: int.id(),
        title: text,
        bio: text,
        authorId: int.column('author_id'),
      },
    }).sql((ctx) => ({
      foreignKeys: [
        ctx.constraints.foreignKey(ctx.cols.authorId, ctx.constraints.ref('User', 'id'), {
          onDelete: 'cascade',
          index: true,
        }),
      ],
    }));
    const PostV2 = model('Post', {
      fields: {
        id: int.id(),
        title: text,
        bio: text.optional(),
        authorId: int.column('author_id'),
      },
    }).sql((ctx) => ({
      foreignKeys: [
        ctx.constraints.foreignKey(ctx.cols.authorId, ctx.constraints.ref('User', 'id'), {
          onDelete: 'cascade',
          index: true,
        }),
      ],
    }));
    const Comment = model('Comment', {
      fields: { id: int.id(), body: text, postId: int.column('post_id') },
    }).sql((ctx) => ({
      foreignKeys: [
        ctx.constraints.foreignKey(ctx.cols.postId, ctx.constraints.ref('Post', 'id'), {
          onDelete: 'cascade',
          index: true,
        }),
      ],
    }));

    await applyMigration(
      {
        origin: defineContract({ models: { User, Post: PostV1, Comment } }),
        destination: defineContract({ models: { User, Post: PostV2, Comment } }),
        policy: WIDENING,
        seed: async (driver) => {
          await driver.query('INSERT INTO "User" (id, name) VALUES (?, ?)', [1, 'Alice']);
          await driver.query('INSERT INTO "Post" (id, title, bio, author_id) VALUES (?, ?, ?, ?)', [
            1,
            'Post 1',
            'original',
            1,
          ]);
          await driver.query('INSERT INTO "Comment" (id, body, post_id) VALUES (?, ?, ?)', [
            1,
            'First comment',
            1,
          ]);
        },
      },
      async ({ driver }) => {
        expect((await driver.query('SELECT * FROM "User"')).rows).toHaveLength(1);
        expect((await driver.query('SELECT * FROM "Post"')).rows).toHaveLength(1);
        const comments = await driver.query<{ id: number; post_id: number; body: string }>(
          'SELECT id, post_id, body FROM "Comment"',
        );
        expect(comments.rows).toHaveLength(1);
        expect(comments.rows[0]).toMatchObject({ id: 1, post_id: 1, body: 'First comment' });

        await expect(
          driver.query('INSERT INTO "Comment" (id, body, post_id) VALUES (?, ?, ?)', [
            2,
            'Orphan',
            999,
          ]),
        ).rejects.toThrow();

        await driver.query('DELETE FROM "Post" WHERE id = ?', [1]);
        expect((await driver.query('SELECT * FROM "Comment"')).rows).toHaveLength(0);
      },
    );
  });

  it('preserves declared unique constraints when the table is recreated', async () => {
    const UserV1 = model('User', {
      fields: {
        id: int.id(),
        email: text.unique(),
        name: text,
        tenant: text,
      },
    }).attributes(({ fields, constraints }) => ({
      uniques: [constraints.unique([fields.name, fields.tenant], { name: 'uq_users_name_tenant' })],
    }));
    const UserV2 = model('User', {
      fields: {
        id: int.id(),
        email: text.unique(),
        name: text.optional(),
        tenant: text,
      },
    }).attributes(({ fields, constraints }) => ({
      uniques: [constraints.unique([fields.name, fields.tenant], { name: 'uq_users_name_tenant' })],
    }));

    await applyMigration(
      {
        origin: defineContract({ models: { User: UserV1 } }),
        destination: defineContract({ models: { User: UserV2 } }),
        policy: WIDENING,
        seed: async (driver) => {
          await driver.query('INSERT INTO "User" (id, email, name, tenant) VALUES (?, ?, ?, ?)', [
            1,
            'alice@example.com',
            'Alice',
            't1',
          ]);
        },
      },
      async ({ driver, schema }) => {
        const uniqueCols = schema.tables['User']!.uniques.map((u) => [...u.columns]);
        expect(uniqueCols).toContainEqual(['email']);
        expect(uniqueCols).toContainEqual(['name', 'tenant']);

        await expect(
          driver.query('INSERT INTO "User" (id, email, name, tenant) VALUES (?, ?, ?, ?)', [
            2,
            'alice@example.com',
            'Bob',
            't2',
          ]),
        ).rejects.toThrow();

        await expect(
          driver.query('INSERT INTO "User" (id, email, name, tenant) VALUES (?, ?, ?, ?)', [
            3,
            'bob@example.com',
            'Alice',
            't1',
          ]),
        ).rejects.toThrow();

        await driver.query('INSERT INTO "User" (id, email, name, tenant) VALUES (?, ?, ?, ?)', [
          4,
          'bob@example.com',
          'Alice',
          't2',
        ]);
      },
    );
  });

  it('preserves caller foreign_keys=OFF when it was disabled at entry', async () => {
    const UserV1 = model('User', { fields: { id: int.id(), name: text, bio: text } });
    const UserV2 = model('User', {
      fields: { id: int.id(), name: text, bio: text.optional() },
    });
    const Post = model('Post', {
      fields: { id: int.id(), title: text, authorId: int.column('author_id') },
    }).sql((ctx) => ({
      foreignKeys: [
        ctx.constraints.foreignKey(ctx.cols.authorId, ctx.constraints.ref('User', 'id'), {
          onDelete: 'cascade',
          index: true,
        }),
      ],
    }));

    await applyMigration(
      {
        origin: defineContract({ models: { User: UserV1, Post } }),
        destination: defineContract({ models: { User: UserV2, Post } }),
        policy: WIDENING,
        seed: async (driver) => {
          await driver.query('INSERT INTO "User" (id, name, bio) VALUES (?, ?, ?)', [
            1,
            'Alice',
            'bio text',
          ]);
          await driver.query('PRAGMA foreign_keys = OFF');
        },
      },
      async ({ driver }) => {
        const pragma = await driver.query<{ foreign_keys: number }>('PRAGMA foreign_keys');
        expect(pragma.rows[0]!.foreign_keys).toBe(0);
      },
    );
  });

  it('surfaces FOREIGN_KEY_VIOLATION when integrity check fails after recreate', async () => {
    const UserV1 = model('User', { fields: { id: int.id(), name: text, bio: text } });
    const UserV2 = model('User', {
      fields: { id: int.id(), name: text, bio: text.optional() },
    });
    const Post = model('Post', {
      fields: { id: int.id(), title: text, authorId: int.column('author_id') },
    }).sql((ctx) => ({
      foreignKeys: [
        ctx.constraints.foreignKey(ctx.cols.authorId, ctx.constraints.ref('User', 'id'), {
          onDelete: 'cascade',
          index: true,
        }),
      ],
    }));

    await expect(
      applyMigration(
        {
          origin: defineContract({ models: { User: UserV1, Post } }),
          destination: defineContract({ models: { User: UserV2, Post } }),
          policy: WIDENING,
          seed: async (driver) => {
            await driver.query('INSERT INTO "User" (id, name, bio) VALUES (?, ?, ?)', [
              1,
              'Alice',
              'bio',
            ]);
            await driver.query('INSERT INTO "Post" (id, title, author_id) VALUES (?, ?, ?)', [
              1,
              'Post 1',
              1,
            ]);
            // Inject an orphan row with FK enforcement temporarily disabled so it
            // survives until the runner's foreign_key_check runs.
            await driver.query('PRAGMA foreign_keys = OFF');
            await driver.query('INSERT INTO "Post" (id, title, author_id) VALUES (?, ?, ?)', [
              2,
              'Orphan',
              999,
            ]);
            await driver.query('PRAGMA foreign_keys = ON');
          },
        },
        async () => {
          // Not reached — the runner should fail before the assertions run.
        },
      ),
    ).rejects.toThrow(/FOREIGN_KEY_VIOLATION/);
  });

  it('introduces a new FK on an existing column (exercises recreate FK postcheck)', async () => {
    // Origin: Post.author_id is a plain INT with no FK.
    // Destination: Post.author_id gains a FK → User.id.
    // This emits `foreign_key_mismatch`, which `recreateTableStrategy`
    // absorbs into a widening recreate. The new FK postcheck (added by
    // `buildRecreatePostchecks`) verifies that `pragma_foreign_key_list`
    // reports the FK after recreate — if the postcheck SQL is wrong, the
    // runner fails before the harness's schema verify would have caught
    // it.
    const User = model('User', { fields: { id: int.id(), name: text } });
    const PostNoFk = model('Post', {
      fields: { id: int.id(), title: text, authorId: int.column('author_id') },
    });
    const PostWithFk = model('Post', {
      fields: { id: int.id(), title: text, authorId: int.column('author_id') },
    }).sql((ctx) => ({
      foreignKeys: [
        ctx.constraints.foreignKey(ctx.cols.authorId, ctx.constraints.ref('User', 'id'), {
          onDelete: 'cascade',
        }),
      ],
    }));

    await applyMigration(
      {
        origin: defineContract({ models: { User, Post: PostNoFk } }),
        destination: defineContract({ models: { User, Post: PostWithFk } }),
        policy: WIDENING,
        seed: async (driver) => {
          await driver.query('INSERT INTO "User" (id, name) VALUES (?, ?)', [1, 'Alice']);
          await driver.query('INSERT INTO "Post" (id, title, author_id) VALUES (?, ?, ?)', [
            1,
            'P1',
            1,
          ]);
        },
      },
      async ({ driver, schema, plannedOperationIds }) => {
        expect(plannedOperationIds).toContain('recreateTable.Post');
        expect(schema.tables['Post']!.foreignKeys).toHaveLength(1);
        const fk = schema.tables['Post']!.foreignKeys[0]!;
        expect([...fk.columns]).toEqual(['author_id']);
        expect(fk.referencedTable).toBe('User');
        expect([...fk.referencedColumns]).toEqual(['id']);
        // Existing data preserved through the recreate copy step.
        expect(
          (
            await driver.query<{ id: number; author_id: number }>(
              'SELECT id, author_id FROM "Post"',
            )
          ).rows,
        ).toEqual([{ id: 1, author_id: 1 }]);
      },
    );
  });
});
