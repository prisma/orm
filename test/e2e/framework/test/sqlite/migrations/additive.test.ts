import { defineContract, field, model, now } from '@prisma/orm-sqlite/contract-builder';
import { describe, expect, it } from 'vitest';
import { applyMigration, int, integerColumn, text } from './harness';

// ---------------------------------------------------------------------------
// From empty schema
// ---------------------------------------------------------------------------

describe('SQLite Migration E2E - From empty schema', () => {
  it('creates a single table with PK and NOT NULL', async () => {
    await applyMigration(
      {
        destination: defineContract({
          models: { User: model('User', { fields: { id: int.id(), name: text } }) },
        }),
      },
      async ({ schema }) => {
        expect(schema.tables['User']).toBeDefined();
      },
    );
  });

  it('creates a table with INTEGER PRIMARY KEY (auto-assigned rowid)', async () => {
    await applyMigration(
      {
        destination: defineContract({
          models: { Item: model('Item', { fields: { id: int.id(), value: text.optional() } }) },
        }),
      },
      async ({ driver }) => {
        await driver.query('INSERT INTO "Item" (value) VALUES (?)', ['first']);
        await driver.query('INSERT INTO "Item" (value) VALUES (?)', ['second']);
        const rows = await driver.query<{ id: number }>('SELECT id FROM "Item" ORDER BY id');
        expect(rows.rows).toHaveLength(2);
        expect(rows.rows[0]!.id).toBe(1);
        expect(rows.rows[1]!.id).toBe(2);
      },
    );
  });

  it('creates a table with default values', async () => {
    await applyMigration(
      {
        destination: defineContract({
          models: {
            Setting: model('Setting', {
              fields: {
                id: int.id(),
                label: text.default('untitled'),
                priority: field.column(integerColumn).default('0'),
                isActive: field.column(integerColumn).default('1').column('is_active'),
                createdAt: text.default(now()).column('created_at'),
              },
            }),
          },
        }),
      },
      async ({ driver }) => {
        await driver.query('INSERT INTO "Setting" (id) VALUES (?)', [1]);
        const rows = await driver.query<{
          label: string;
          priority: number;
          is_active: number;
          created_at: string;
        }>('SELECT * FROM "Setting" WHERE id = ?', [1]);
        expect(rows.rows[0]!.label).toBe('untitled');
        expect(rows.rows[0]!.priority).toBe(0);
        expect(rows.rows[0]!.is_active).toBe(1);
        expect(rows.rows[0]!.created_at).toBeTruthy();
      },
    );
  });

  it('creates a table with unique constraints', async () => {
    await applyMigration(
      {
        destination: defineContract({
          models: {
            Account: model('Account', {
              fields: { id: int.id(), email: text.unique(), username: text.unique() },
            }),
          },
        }),
      },
      async ({ schema }) => {
        const cols = schema.tables['Account']!.uniques.map((u) => [...u.columns]);
        expect(cols).toContainEqual(['email']);
        expect(cols).toContainEqual(['username']);
      },
    );
  });

  it('creates tables with FK ON DELETE CASCADE', async () => {
    const Author = model('Author', { fields: { id: int.id(), name: text } });
    const Post = model('Post', {
      fields: { id: int.id(), title: text, authorId: int.column('author_id') },
    }).sql((ctx) => ({
      foreignKeys: [
        ctx.constraints.foreignKey(ctx.cols.authorId, ctx.constraints.ref('Author', 'id'), {
          onDelete: 'cascade',
          index: true,
        }),
      ],
    }));

    await applyMigration(
      { destination: defineContract({ models: { Author, Post } }) },
      async ({ driver }) => {
        await driver.query('INSERT INTO "Author" (id, name) VALUES (?, ?)', [1, 'Alice']);
        await driver.query('INSERT INTO "Post" (id, title, author_id) VALUES (?, ?, ?)', [
          1,
          'Post 1',
          1,
        ]);
        await driver.query('DELETE FROM "Author" WHERE id = ?', [1]);
        expect((await driver.query('SELECT * FROM "Post"')).rows).toHaveLength(0);
      },
    );
  });

  it('creates tables with FK ON DELETE SET NULL', async () => {
    const Category = model('Category', { fields: { id: int.id(), name: text } });
    const Post = model('Post', {
      fields: { id: int.id(), title: text, categoryId: int.optional().column('category_id') },
    }).sql((ctx) => ({
      foreignKeys: [
        ctx.constraints.foreignKey(ctx.cols.categoryId, ctx.constraints.ref('Category', 'id'), {
          onDelete: 'setNull',
          index: true,
        }),
      ],
    }));

    await applyMigration(
      { destination: defineContract({ models: { Category, Post } }) },
      async ({ driver }) => {
        await driver.query('INSERT INTO "Category" (id, name) VALUES (?, ?)', [1, 'Tech']);
        await driver.query('INSERT INTO "Post" (id, title, category_id) VALUES (?, ?, ?)', [
          1,
          'Post 1',
          1,
        ]);
        await driver.query('DELETE FROM "Category" WHERE id = ?', [1]);
        const rows = await driver.query<{ category_id: number | null }>(
          'SELECT category_id FROM "Post" WHERE id = ?',
          [1],
        );
        expect(rows.rows[0]!.category_id).toBeNull();
      },
    );
  });

  it('creates a table with indexes', async () => {
    await applyMigration(
      {
        destination: defineContract({
          models: {
            Event: model('Event', {
              fields: { id: int.id(), name: text, date: text, location: text.optional() },
            }).sql((ctx) => ({
              indexes: [
                ctx.constraints.index([ctx.cols.date], { name: 'idx_events_date' }),
                ctx.constraints.index([ctx.cols.name, ctx.cols.date], {
                  name: 'idx_events_name_date',
                }),
              ],
            })),
          },
        }),
      },
      async ({ schema }) => {
        const cols = schema.tables['Event']!.indexes.map((i) => [...(i.columns ?? [])]);
        expect(cols).toContainEqual(['date']);
        expect(cols).toContainEqual(['name', 'date']);
      },
    );
  });
});

// ---------------------------------------------------------------------------
// Schema evolution
// ---------------------------------------------------------------------------

describe('SQLite Migration E2E - Schema evolution', () => {
  it('adds a new nullable column', async () => {
    await applyMigration(
      {
        origin: defineContract({
          models: { User: model('User', { fields: { id: int.id(), name: text } }) },
        }),
        destination: defineContract({
          models: {
            User: model('User', { fields: { id: int.id(), name: text, bio: text.optional() } }),
          },
        }),
      },
      async ({ schema }) => {
        expect(schema.tables['User']!.columns['bio']).toBeDefined();
      },
    );
  });

  it('adds a new column with a default value', async () => {
    await applyMigration(
      {
        origin: defineContract({
          models: { User: model('User', { fields: { id: int.id(), name: text } }) },
        }),
        destination: defineContract({
          models: {
            User: model('User', {
              fields: { id: int.id(), name: text, status: text.default('active') },
            }),
          },
        }),
      },
      async ({ driver }) => {
        await driver.query('INSERT INTO "User" (id, name) VALUES (?, ?)', [1, 'Alice']);
        expect(
          (await driver.query<{ status: string }>('SELECT status FROM "User" WHERE id = ?', [1]))
            .rows[0]!.status,
        ).toBe('active');
      },
    );
  });

  it('adds a new table alongside existing tables', async () => {
    const UserModel = model('User', { fields: { id: int.id(), name: text } });
    const PostModel = model('Post', {
      fields: { id: int.id(), title: text, userId: int.column('user_id') },
    }).sql((ctx) => ({
      foreignKeys: [ctx.constraints.foreignKey(ctx.cols.userId, ctx.constraints.ref('User', 'id'))],
    }));

    await applyMigration(
      {
        origin: defineContract({ models: { User: UserModel } }),
        destination: defineContract({ models: { User: UserModel, Post: PostModel } }),
      },
      async ({ schema }) => {
        expect(schema.tables['User']).toBeDefined();
        expect(schema.tables['Post']).toBeDefined();
      },
    );
  });

  it('adds an index to an existing table', async () => {
    await applyMigration(
      {
        origin: defineContract({
          models: { User: model('User', { fields: { id: int.id(), email: text } }) },
        }),
        destination: defineContract({
          models: {
            User: model('User', { fields: { id: int.id(), email: text } }).sql((ctx) => ({
              indexes: [ctx.constraints.index([ctx.cols.email], { name: 'idx_users_email' })],
            })),
          },
        }),
      },
      async ({ schema }) => {
        expect(schema.tables['User']!.indexes.map((i) => [...(i.columns ?? [])])).toContainEqual([
          'email',
        ]);
      },
    );
  });

  it('applies a multi-step migration: new columns, indexes, and table', async () => {
    await applyMigration(
      {
        origin: defineContract({
          models: { User: model('User', { fields: { id: int.id(), email: text } }) },
        }),
        destination: defineContract({
          models: {
            User: model('User', {
              fields: {
                id: int.id(),
                email: text,
                bio: text.optional(),
                status: text.default('active'),
              },
            }).sql((ctx) => ({
              indexes: [ctx.constraints.index([ctx.cols.email], { name: 'idx_users_email' })],
            })),
            Post: model('Post', {
              fields: { id: int.id(), title: text, userId: int.column('user_id') },
            }).sql((ctx) => ({
              foreignKeys: [
                ctx.constraints.foreignKey(ctx.cols.userId, ctx.constraints.ref('User', 'id')),
              ],
            })),
          },
        }),
      },
      async ({ schema, operationsExecuted }) => {
        expect(schema.tables['User']!.columns['bio']).toBeDefined();
        expect(schema.tables['User']!.columns['status']).toBeDefined();
        expect(schema.tables['Post']).toBeDefined();
        expect(operationsExecuted).toBeGreaterThanOrEqual(4);
      },
    );
  });
});
