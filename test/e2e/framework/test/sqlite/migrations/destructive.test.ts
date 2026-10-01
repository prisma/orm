import { defineContract, model } from '@prisma/orm-sqlite/contract-builder';
import { describe, expect, it } from 'vitest';
import { applyMigration, int, text } from './harness';

// ---------------------------------------------------------------------------
// Drops: a table drop is destructive; an index drop, alone or in a replacement, is widening
// ---------------------------------------------------------------------------

describe('SQLite Migration E2E - Drops', () => {
  const DESTRUCTIVE = { allowedOperationClasses: ['additive', 'destructive'] } as const;
  const WIDENING = { allowedOperationClasses: ['additive', 'widening'] } as const;

  it('drops a table removed from the contract', async () => {
    await applyMigration(
      {
        origin: defineContract({
          models: {
            User: model('User', { fields: { id: int.id(), name: text } }),
            Legacy: model('Legacy', { fields: { id: int.id(), data: text } }),
          },
        }),
        destination: defineContract({
          models: { User: model('User', { fields: { id: int.id(), name: text } }) },
        }),
        policy: DESTRUCTIVE,
      },
      async ({ schema }) => {
        expect(schema.tables['User']).toBeDefined();
        expect(schema.tables['Legacy']).toBeUndefined();
      },
    );
  });

  it('drops an index removed from the contract', async () => {
    await applyMigration(
      {
        origin: defineContract({
          models: {
            User: model('User', { fields: { id: int.id(), email: text } }).sql((ctx) => ({
              indexes: [ctx.constraints.index([ctx.cols.email], { name: 'idx_users_email' })],
            })),
          },
        }),
        destination: defineContract({
          models: { User: model('User', { fields: { id: int.id(), email: text } }) },
        }),
        policy: WIDENING,
      },
      async ({ schema }) => {
        expect(schema.tables['User']!.indexes).toHaveLength(0);
      },
    );
  });

  it('replaces an index (drop old + create new)', async () => {
    await applyMigration(
      {
        origin: defineContract({
          models: {
            User: model('User', { fields: { id: int.id(), email: text, name: text } }).sql(
              (ctx) => ({
                indexes: [ctx.constraints.index([ctx.cols.email], { name: 'idx_email' })],
              }),
            ),
          },
        }),
        destination: defineContract({
          models: {
            User: model('User', { fields: { id: int.id(), email: text, name: text } }).sql(
              (ctx) => ({
                indexes: [ctx.constraints.index([ctx.cols.name], { name: 'idx_name' })],
              }),
            ),
          },
        }),
        policy: WIDENING,
      },
      async ({ schema }) => {
        const cols = schema.tables['User']!.indexes.map((i) => [...(i.columns ?? [])]);
        expect(cols).toContainEqual(['name']);
        expect(cols).not.toContainEqual(['email']);
      },
    );
  });
});

// ---------------------------------------------------------------------------
// Destructive column / constraint changes (via recreate-table)
// ---------------------------------------------------------------------------

describe('SQLite Migration E2E - Destructive column changes', () => {
  const ALL = { allowedOperationClasses: ['additive', 'widening', 'destructive'] } as const;

  it('drops a column', async () => {
    await applyMigration(
      {
        origin: defineContract({
          models: {
            User: model('User', {
              fields: {
                id: int.id(),
                name: text,
                legacyField: text.optional().column('legacy_field'),
              },
            }),
          },
        }),
        destination: defineContract({
          models: { User: model('User', { fields: { id: int.id(), name: text } }) },
        }),
        policy: ALL,
      },
      async ({ schema }) => {
        expect(schema.tables['User']!.columns['legacy_field']).toBeUndefined();
        expect(schema.tables['User']!.columns['name']).toBeDefined();
      },
    );
  });

  it('changes a column type', async () => {
    await applyMigration(
      {
        origin: defineContract({
          models: { Item: model('Item', { fields: { id: int.id(), value: text } }) },
        }),
        destination: defineContract({
          models: { Item: model('Item', { fields: { id: int.id(), value: int.optional() } }) },
        }),
        policy: ALL,
      },
      async ({ schema }) => {
        expect(schema.tables['Item']!.columns['value']!.nativeType).toBe('integer');
      },
    );
  });

  it('tightens nullability (nullable to NOT NULL)', async () => {
    await applyMigration(
      {
        origin: defineContract({
          models: { User: model('User', { fields: { id: int.id(), name: text.optional() } }) },
        }),
        destination: defineContract({
          models: { User: model('User', { fields: { id: int.id(), name: text } }) },
        }),
        policy: ALL,
      },
      async ({ schema }) => {
        expect(schema.tables['User']!.columns['name']!.nullable).toBe(false);
      },
    );
  });

  it('drops a column and preserves remaining data', async () => {
    await applyMigration(
      {
        origin: defineContract({
          models: {
            User: model('User', { fields: { id: int.id(), name: text, temp: text.optional() } }),
          },
        }),
        destination: defineContract({
          models: { User: model('User', { fields: { id: int.id(), name: text } }) },
        }),
        policy: ALL,
        seed: async (driver) => {
          await driver.query('INSERT INTO "User" (id, name, temp) VALUES (?, ?, ?)', [
            1,
            'Alice',
            'remove-me',
          ]);
        },
      },
      async ({ driver }) => {
        const rows = await driver.query<{ id: number; name: string }>(
          'SELECT * FROM "User" ORDER BY id',
        );
        expect(rows.rows).toHaveLength(1);
        expect(rows.rows[0]).toMatchObject({ id: 1, name: 'Alice' });
      },
    );
  });

  it('changes a column type and preserves data', async () => {
    await applyMigration(
      {
        origin: defineContract({
          models: { Item: model('Item', { fields: { id: int.id(), value: text } }) },
        }),
        destination: defineContract({
          models: { Item: model('Item', { fields: { id: int.id(), value: int.optional() } }) },
        }),
        policy: ALL,
        seed: async (driver) => {
          await driver.query('INSERT INTO "Item" (id, value) VALUES (?, ?)', [1, '42']);
          await driver.query('INSERT INTO "Item" (id, value) VALUES (?, ?)', [2, '0']);
        },
      },
      async ({ driver, schema }) => {
        expect(schema.tables['Item']!.columns['value']!.nativeType).toBe('integer');
        const rows = await driver.query<{ id: number; value: number }>(
          'SELECT * FROM "Item" ORDER BY id',
        );
        expect(rows.rows).toHaveLength(2);
        expect(rows.rows[0]).toMatchObject({ id: 1, value: 42 });
        expect(rows.rows[1]).toMatchObject({ id: 2, value: 0 });
      },
    );
  });

  it('combined: drop column + change type + tighten nullability', async () => {
    await applyMigration(
      {
        origin: defineContract({
          models: {
            Record: model('Record', {
              fields: {
                id: int.id(),
                value: text.optional(),
                oldField: text.optional().column('old_field'),
              },
            }),
          },
        }),
        destination: defineContract({
          models: { Record: model('Record', { fields: { id: int.id(), value: int } }) },
        }),
        policy: ALL,
      },
      async ({ schema }) => {
        expect(schema.tables['Record']!.columns['old_field']).toBeUndefined();
        expect(schema.tables['Record']!.columns['value']!.nativeType).toBe('integer');
        expect(schema.tables['Record']!.columns['value']!.nullable).toBe(false);
      },
    );
  });
});
