import { datetimeColumn } from '@prisma/orm-sqlite/adapter/column-types';
import { defineContract, field, model, now, sql } from '@prisma/orm-sqlite/contract-builder';
import { describe, expect, it } from 'vitest';
import { applyMigration, int, text } from './harness';

describe('SQLite Migration E2E - Widening operations (recreate-table)', () => {
  const WIDENING = { allowedOperationClasses: ['additive', 'widening'] } as const;

  it('relaxes NOT NULL to nullable', async () => {
    await applyMigration(
      {
        origin: defineContract({
          models: { User: model('User', { fields: { id: int.id(), name: text, bio: text } }) },
        }),
        destination: defineContract({
          models: {
            User: model('User', { fields: { id: int.id(), name: text, bio: text.optional() } }),
          },
        }),
        policy: WIDENING,
      },
      async ({ schema, driver }) => {
        expect(schema.tables['User']!.columns['bio']!.nullable).toBe(true);
        await driver.query('INSERT INTO "User" (id, name, bio) VALUES (?, ?, ?)', [
          1,
          'Alice',
          null,
        ]);
        expect(
          (await driver.query<{ bio: string | null }>('SELECT bio FROM "User" WHERE id = ?', [1]))
            .rows[0]!.bio,
        ).toBeNull();
      },
    );
  });

  it('changes a column default', async () => {
    await applyMigration(
      {
        origin: defineContract({
          models: {
            Setting: model('Setting', { fields: { id: int.id(), status: text.default('draft') } }),
          },
        }),
        destination: defineContract({
          models: {
            Setting: model('Setting', { fields: { id: int.id(), status: text.default('active') } }),
          },
        }),
        policy: WIDENING,
      },
      async ({ driver }) => {
        await driver.query('INSERT INTO "Setting" (id) VALUES (?)', [1]);
        expect(
          (await driver.query<{ status: string }>('SELECT status FROM "Setting" WHERE id = ?', [1]))
            .rows[0]!.status,
        ).toBe('active');
      },
    );
  });

  // Round-trip regression for the canonical `now()` default. SQLite has
  // several spellings for "wall-clock now" (`CURRENT_TIMESTAMP`,
  // `datetime('now')`, the bare `now()` form): `parseSqliteDefault`
  // canonicalizes the schema side, and `lowerDbgenerated` canonicalizes
  // the contract side. As long as both sides converge on `now()`, the
  // additive apply must verify clean and the column's stored default
  // must be one of the SQLite-native spellings (the runner's
  // post-execute schema verify already proves the canonical
  // equivalence; this assertion just pins the storage form).
  it('round-trips a `now()` default through apply + introspect without drift', async () => {
    await applyMigration(
      {
        destination: defineContract({
          models: {
            User: model('User', {
              fields: {
                id: int.id(),
                name: text,
                createdAt: field.column(datetimeColumn).default(now()),
              },
            }),
          },
        }),
      },
      async ({ schema, driver }) => {
        const stored = schema.tables['User']!.columns['createdAt']!.default;
        expect(stored).toBe("datetime('now')");
        await driver.query('INSERT INTO "User" (id, name) VALUES (?, ?)', [1, 'Alice']);
        const row = (
          await driver.query<{ createdAt: string }>(
            'SELECT createdAt FROM "User" WHERE id = ?',
            [1],
          )
        ).rows[0];
        expect(typeof row?.createdAt).toBe('string');
      },
    );
  });

  it('stores a sql`CURRENT_TIMESTAMP` default verbatim and verifies clean against it', async () => {
    await applyMigration(
      {
        destination: defineContract({
          models: {
            User: model('User', {
              fields: {
                id: int.id(),
                name: text,
                createdAt: field.column(datetimeColumn).default(sql`CURRENT_TIMESTAMP`),
              },
            }),
          },
        }),
      },
      async ({ schema, driver }) => {
        expect(schema.tables['User']!.columns['createdAt']!.default).toBe('CURRENT_TIMESTAMP');
        await driver.query('INSERT INTO "User" (id, name) VALUES (?, ?)', [1, 'Alice']);
        const row = (
          await driver.query<{ createdAt: string }>(
            'SELECT createdAt FROM "User" WHERE id = ?',
            [1],
          )
        ).rows[0];
        expect(typeof row?.createdAt).toBe('string');
      },
    );
  });

  it.each([
    ['sql`CURRENT_TIMESTAMP`', sql`CURRENT_TIMESTAMP`],
    ["sql`'x'`", sql`'x'`],
  ])('plans no operation once %s has been applied', async (_label, columnDefault) => {
    const contract = defineContract({
      models: {
        User: model('User', {
          fields: {
            id: int.id(),
            name: text,
            createdAt: field.column(datetimeColumn).default(columnDefault),
          },
        }),
      },
    });
    await applyMigration(
      { origin: contract, destination: contract },
      async ({ plannedOperationIds }) => {
        expect(plannedOperationIds).toEqual([]);
      },
    );
  });

  it('round-trips a string default with an apostrophe through recreate-table', async () => {
    await applyMigration(
      {
        origin: defineContract({
          models: {
            User: model('User', {
              fields: { id: int.id(), nickname: text.default('old') },
            }),
          },
        }),
        destination: defineContract({
          models: {
            User: model('User', {
              fields: { id: int.id(), nickname: text.default("It's") },
            }),
          },
        }),
        policy: WIDENING,
      },
      async ({ schema, driver }) => {
        expect(schema.tables['User']!.columns['nickname']!.default).toBe("'It''s'");

        await driver.query('INSERT INTO "User" (id) VALUES (?)', [1]);
        const row = (
          await driver.query<{ nickname: string }>('SELECT nickname FROM "User" WHERE id = ?', [1])
        ).rows[0];
        expect(row?.nickname).toBe("It's");
      },
    );
  });

  it('preserves existing data through recreate-table', async () => {
    await applyMigration(
      {
        origin: defineContract({
          models: { User: model('User', { fields: { id: int.id(), name: text, email: text } }) },
        }),
        destination: defineContract({
          models: {
            User: model('User', { fields: { id: int.id(), name: text, email: text.optional() } }),
          },
        }),
        policy: WIDENING,
        seed: async (driver) => {
          await driver.query('INSERT INTO "User" (id, name, email) VALUES (?, ?, ?)', [
            1,
            'Alice',
            'alice@example.com',
          ]);
          await driver.query('INSERT INTO "User" (id, name, email) VALUES (?, ?, ?)', [
            2,
            'Bob',
            'bob@example.com',
          ]);
        },
      },
      async ({ driver }) => {
        const rows = await driver.query<{ id: number; name: string; email: string }>(
          'SELECT * FROM "User" ORDER BY id',
        );
        expect(rows.rows).toHaveLength(2);
        expect(rows.rows[0]).toMatchObject({ id: 1, name: 'Alice', email: 'alice@example.com' });
        expect(rows.rows[1]).toMatchObject({ id: 2, name: 'Bob', email: 'bob@example.com' });
      },
    );
  });
});
