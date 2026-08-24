import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { JsonValue } from '@prisma/orm-sqlite/adapter/codec-types';
import { UNBOUND_NAMESPACE_ID } from '@prisma/orm-sqlite/components/ir';
import { timeouts } from '@repo/test-utils';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Contract } from './fixtures/generated/contract.d';
import { withSqliteTestRuntime } from './utils';

const __dirname = dirname(fileURLToPath(import.meta.url));
const contractJsonPath = resolve(__dirname, 'fixtures/generated/contract.json');

describe('e2e: ORM on SQLite', { timeout: timeouts.databaseOperation }, () => {
  describe('findMany', () => {
    it('returns all rows', async () => {
      await withSqliteTestRuntime<Contract>(contractJsonPath, async ({ ormClient }) => {
        const users = await ormClient[UNBOUND_NAMESPACE_ID].User.all();
        expect(users).toHaveLength(4);

        expectTypeOf(users[0]!).toEqualTypeOf<{
          id: number;
          name: string;
          email: string;
          invitedById: number | null;
        }>();
      });
    });

    it('with filter', async () => {
      await withSqliteTestRuntime<Contract>(contractJsonPath, async ({ ormClient }) => {
        const users = await ormClient[UNBOUND_NAMESPACE_ID].User.where({ id: 1 }).all();
        expect(users).toHaveLength(1);
        expect(users[0]!.name).toBe('Alice');
      });
    });

    it('with ordering', async () => {
      await withSqliteTestRuntime<Contract>(contractJsonPath, async ({ ormClient }) => {
        const users = await ormClient[UNBOUND_NAMESPACE_ID].User.orderBy((u) => u.id.desc()).all();
        expect(users[0]!.id).toBe(4);
      });
    });

    it('with limit and offset', async () => {
      await withSqliteTestRuntime<Contract>(contractJsonPath, async ({ ormClient }) => {
        const users = await ormClient[UNBOUND_NAMESPACE_ID].User.orderBy((u) => u.id.asc())
          .offset(1)
          .limit(2)
          .all();
        expect(users).toHaveLength(2);
        expect(users[0]!.id).toBe(2);
      });
    });
  });

  describe('findFirst', () => {
    it('returns first matching row', async () => {
      await withSqliteTestRuntime<Contract>(contractJsonPath, async ({ ormClient }) => {
        const user = await ormClient[UNBOUND_NAMESPACE_ID].User.where({ id: 1 }).first();
        expect(user).not.toBeNull();
        expect(user!.name).toBe('Alice');

        expectTypeOf(user).toEqualTypeOf<{
          id: number;
          name: string;
          email: string;
          invitedById: number | null;
        } | null>();
      });
    });

    it('returns null when no match', async () => {
      await withSqliteTestRuntime<Contract>(contractJsonPath, async ({ ormClient }) => {
        const user = await ormClient[UNBOUND_NAMESPACE_ID].User.where({ id: 9999 }).first();
        expect(user).toBeNull();
      });
    });
  });

  describe('create', () => {
    it('creates a row and returns it', async () => {
      await withSqliteTestRuntime<Contract>(contractJsonPath, async ({ ormClient }) => {
        const user = await ormClient[UNBOUND_NAMESPACE_ID].User.create({
          id: 200,
          name: 'Created',
          email: 'created@example.com',
        });
        expect(user.id).toBe(200);
        expect(user.name).toBe('Created');

        expectTypeOf(user).toEqualTypeOf<{
          id: number;
          name: string;
          email: string;
          invitedById: number | null;
        }>();

        await ormClient[UNBOUND_NAMESPACE_ID].User.where({ id: 200 }).deleteAndCount();
      });
    });
  });

  describe('createAll', () => {
    it('creates multiple rows', async () => {
      await withSqliteTestRuntime<Contract>(contractJsonPath, async ({ ormClient }) => {
        const rows = await ormClient[UNBOUND_NAMESPACE_ID].User.createAll([
          { id: 500, name: 'Batch1', email: 'batch1@example.com' },
          { id: 501, name: 'Batch2', email: 'batch2@example.com' },
        ]);
        expect(rows).toHaveLength(2);
        expect(rows[0]!.id).toBe(500);
        expect(rows[1]!.id).toBe(501);

        await ormClient[UNBOUND_NAMESPACE_ID].User.where({ id: 500 }).deleteAndCount();
        await ormClient[UNBOUND_NAMESPACE_ID].User.where({ id: 501 }).deleteAndCount();
      });
    });
  });

  describe('update', () => {
    it('updates and returns updated row', async () => {
      await withSqliteTestRuntime<Contract>(contractJsonPath, async ({ ormClient }) => {
        const updated = await ormClient[UNBOUND_NAMESPACE_ID].User.where({ id: 2 }).update({
          name: 'Bob Updated',
        });
        expect(updated!.name).toBe('Bob Updated');

        await ormClient[UNBOUND_NAMESPACE_ID].User.where({ id: 2 }).update({ name: 'Bob' });
      });
    });
  });

  describe('updateAll', () => {
    it('updates multiple rows and returns them', async () => {
      await withSqliteTestRuntime<Contract>(contractJsonPath, async ({ ormClient }) => {
        await ormClient[UNBOUND_NAMESPACE_ID].User.create({
          id: 600,
          name: 'UpdA',
          email: 'upda@example.com',
        });
        await ormClient[UNBOUND_NAMESPACE_ID].User.create({
          id: 601,
          name: 'UpdB',
          email: 'updb@example.com',
        });

        const updated = await ormClient[UNBOUND_NAMESPACE_ID].User.where({ id: 600 }).update({
          name: 'Updated',
        });
        await ormClient[UNBOUND_NAMESPACE_ID].User.where({ id: 601 }).update({ name: 'Updated' });
        expect(updated!.name).toBe('Updated');

        await ormClient[UNBOUND_NAMESPACE_ID].User.where({ id: 600 }).deleteAndCount();
        await ormClient[UNBOUND_NAMESPACE_ID].User.where({ id: 601 }).deleteAndCount();
      });
    });
  });

  describe('delete', () => {
    it('deletes matching rows and returns count', async () => {
      await withSqliteTestRuntime<Contract>(contractJsonPath, async ({ ormClient }) => {
        await ormClient[UNBOUND_NAMESPACE_ID].User.create({
          id: 300,
          name: 'ToDelete',
          email: 'delete@example.com',
        });
        const count = await ormClient[UNBOUND_NAMESPACE_ID].User.where({
          id: 300,
        }).deleteAndCount();
        expect(count).toBe(1);

        expectTypeOf(count).toBeNumber();
      });
    });

    it('deleteAll returns deleted rows', async () => {
      await withSqliteTestRuntime<Contract>(contractJsonPath, async ({ ormClient }) => {
        await ormClient[UNBOUND_NAMESPACE_ID].User.create({
          id: 700,
          name: 'DelA',
          email: 'dela@example.com',
        });
        await ormClient[UNBOUND_NAMESPACE_ID].User.create({
          id: 701,
          name: 'DelB',
          email: 'delb@example.com',
        });

        const deletedA = await ormClient[UNBOUND_NAMESPACE_ID].User.where({
          id: 700,
        }).deleteAndCount();
        const deletedB = await ormClient[UNBOUND_NAMESPACE_ID].User.where({
          id: 701,
        }).deleteAndCount();
        expect(deletedA + deletedB).toBe(2);
      });
    });
  });

  describe('include', () => {
    it('loads 1:N relation via json_group_array', async () => {
      await withSqliteTestRuntime<Contract>(contractJsonPath, async ({ ormClient }) => {
        const users = await ormClient[UNBOUND_NAMESPACE_ID].User.where({ id: 1 })
          .include('posts')
          .all();
        expect(users).toHaveLength(1);
        expect(users[0]!.posts).toHaveLength(2);
      });
    });
  });

  describe('codec round-trip through ORM', () => {
    it('creates and reads typed rows', async () => {
      await withSqliteTestRuntime<Contract>(contractJsonPath, async ({ ormClient }) => {
        await ormClient[UNBOUND_NAMESPACE_ID].TypedRow.create({
          id: 10,
          active: 1,
          createdAt: new Date('2024-03-15T10:30:00.000Z'),
          metadata: { tags: ['a', 'b'], count: 42 },
          label: 'test',
        });

        const found = await ormClient[UNBOUND_NAMESPACE_ID].TypedRow.where({ id: 10 }).first();
        expect(found).not.toBeNull();
        expect(found!.id).toBe(10);
        expect(found!.label).toBe('test');

        expectTypeOf(found).toEqualTypeOf<{
          id: number;
          active: number;
          createdAt: Date;
          metadata: JsonValue | null;
          label: string;
        } | null>();

        await ormClient[UNBOUND_NAMESPACE_ID].TypedRow.where({ id: 10 }).deleteAndCount();
      });
    });

    it('null JSON round-trips correctly', async () => {
      await withSqliteTestRuntime<Contract>(contractJsonPath, async ({ ormClient }) => {
        const created = await ormClient[UNBOUND_NAMESPACE_ID].TypedRow.create({
          id: 12,
          active: 1,
          createdAt: new Date('2024-01-01T00:00:00.000Z'),
          label: 'no-meta',
        });
        expect(created.metadata).toBeNull();

        const found = await ormClient[UNBOUND_NAMESPACE_ID].TypedRow.where({ id: 12 }).first();
        expect(found).not.toBeNull();
        expect(found!.metadata).toBeNull();

        await ormClient[UNBOUND_NAMESPACE_ID].TypedRow.where({ id: 12 }).deleteAndCount();
      });
    });
  });

  describe('mixed defaults in multi-row insert', () => {
    it('createAll with rows where one provides label explicitly and the other uses DB default', async () => {
      await withSqliteTestRuntime<Contract>(contractJsonPath, async ({ ormClient }) => {
        const rows = await ormClient[UNBOUND_NAMESPACE_ID].Item.createAll([
          { id: 900, name: 'Explicit', label: 'custom' },
          { id: 901, name: 'Default' },
        ]);
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({ id: 900, name: 'Explicit', label: 'custom' });
        expect(rows[1]).toMatchObject({ id: 901, name: 'Default', label: 'unnamed' });

        await ormClient[UNBOUND_NAMESPACE_ID].Item.where({ id: 900 }).deleteAndCount();
        await ormClient[UNBOUND_NAMESPACE_ID].Item.where({ id: 901 }).deleteAndCount();
      });
    });
  });

  describe('upsert', () => {
    it('inserts when row does not exist', async () => {
      await withSqliteTestRuntime<Contract>(contractJsonPath, async ({ ormClient }) => {
        const result = await ormClient[UNBOUND_NAMESPACE_ID].User.upsert({
          create: { id: 800, name: 'Upserted', email: 'upsert@example.com' },
          update: { name: 'Updated' },
        });
        expect(result.id).toBe(800);
        expect(result.name).toBe('Upserted');

        await ormClient[UNBOUND_NAMESPACE_ID].User.where({ id: 800 }).deleteAndCount();
      });
    });

    it('updates when row already exists', async () => {
      await withSqliteTestRuntime<Contract>(contractJsonPath, async ({ ormClient }) => {
        await ormClient[UNBOUND_NAMESPACE_ID].User.create({
          id: 801,
          name: 'Original',
          email: 'orig@example.com',
        });

        const result = await ormClient[UNBOUND_NAMESPACE_ID].User.upsert({
          create: { id: 801, name: 'CreateName', email: 'orig@example.com' },
          update: { name: 'UpsertUpdated' },
        });
        expect(result.id).toBe(801);
        expect(result.name).toBe('UpsertUpdated');

        await ormClient[UNBOUND_NAMESPACE_ID].User.where({ id: 801 }).deleteAndCount();
      });
    });
  });
});
