import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { orm } from '@internal/sql-orm-client';
import sqlite from '@internal/sqlite/runtime';
import { contractFromJson } from '@internal/sqlite/static';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import type { Contract } from './fixtures/sqlite/generated/contract';
import contractJson from './fixtures/sqlite/generated/contract.json' with { type: 'json' };
import { pushContract } from './push-sqlite';
import { withoutCapabilities } from './without-capabilities';

const contract = contractFromJson<Contract>(contractJson);

type Client = ReturnType<typeof sqlite<Contract>>;

async function withDatabase(run: (db: Client) => Promise<void>): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'orm-known-failures-'));
  const path = join(directory, 'test.db');
  await pushContract(path, contractJson);
  try {
    await using db = sqlite({ contract, path, verifyMarker: false });
    await run(db);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function withoutReturning(db: Client) {
  return orm({
    context: withoutCapabilities(db.context, ['returning']),
    runtime: db.runtime(),
  })[UNBOUND_NAMESPACE_ID];
}

describe('SQLite ORM calls known to fail', () => {
  describe('a BigInt beyond the safe integer range', () => {
    it.fails('is returned by the create that stores it', async () => {
      await withDatabase(async (db) => {
        expect(await db.orm.Counter.create({ id: 1, big: 2n ** 62n })).toEqual({
          id: 1,
          big: 2n ** 62n,
        });
      });
    });

    it.fails('is read back', async () => {
      await withDatabase(async (db) => {
        await db.orm.Counter.createAndCount([{ id: 1, big: 2n ** 62n }]);
        expect(await db.orm.Counter.select('id', 'big').all()).toEqual([{ id: 1, big: 2n ** 62n }]);
      });
    });
  });

  describe('a Char value with a trailing space', () => {
    it.fails('is found by a filter on the value read back', async () => {
      await withDatabase(async (db) => {
        await db.orm.Label.createAndCount([{ id: 1, code: 'a ' }]);
        const label = await db.orm.Label.whereUnique({ id: 1 }).select('id', 'code').firstOrThrow();
        expect(await db.orm.Label.where({ code: label.code }).select('id').all()).toEqual([
          { id: 1 },
        ]);
      });
    });
  });

  describe('select before create on a variant', () => {
    it.fails('returns only the selected fields of a variant stored in its own table', async () => {
      await withDatabase(async (db) => {
        expect(
          await db.orm.Task.variant('feature')
            .select('id', 'title')
            .create({ id: 2, title: 'Dark mode', priority: 3 }),
        ).toEqual({ id: 2, title: 'Dark mode' });
      });
    });
  });

  describe('create on a variant with a relation callback', () => {
    it.fails('stores a variant in its own table', async () => {
      await withDatabase(async (db) => {
        await db.orm.Project.createAndCount([{ id: 1 }]);
        expect(
          await db.orm.Task.variant('feature').create({
            id: 2,
            title: 'Dark mode',
            priority: 3,
            project: (project) => project.connect({ id: 1 }),
          }),
        ).toEqual({ id: 2, title: 'Dark mode', kind: 'feature', priority: 3, projectId: 1 });
      });
    });
  });

  describe('upsert on a variant whose key a row of another variant holds', () => {
    it.each([
      ['with RETURNING', (db: Client) => db.orm.Task],
      ['without RETURNING', (db: Client) => withoutReturning(db).Task],
    ])('is refused and leaves that row unchanged, %s', async (_path, tasks) => {
      await withDatabase(async (db) => {
        await db.orm.Task.variant('bug').create({ id: 1, title: 'Crash', severity: 'high' });

        await expect(
          tasks(db)
            .variant('chore')
            .upsert({
              create: { id: 1, title: 'Dishes', effort: 2 },
              update: { title: 'Dishes' },
              conflictOn: { id: 1 },
            }),
        ).rejects.toMatchObject({
          code: 'ORM.MUTATION_ROW_MISSING',
          message:
            'upsert() on variant "Chore" of model "Task" found the conflict values (id) on a row of another variant, which it leaves unchanged',
        });
        expect(await db.orm.Task.select('id', 'title', 'kind').all()).toEqual([
          { id: 1, title: 'Crash', kind: 'bug' },
        ]);
      });
    });

    it('creates the row when no row holds the key and updates a row of the variant that does', async () => {
      await withDatabase(async (db) => {
        const chores = db.orm.Task.variant('chore').select('id', 'title', 'kind');
        const upsert = (title: string) =>
          chores.upsert({
            create: { id: 1, title, effort: 2 },
            update: { title },
            conflictOn: { id: 1 },
          });

        expect({ created: await upsert('Dishes'), updated: await upsert('Laundry') }).toEqual({
          created: { id: 1, title: 'Dishes', kind: 'chore' },
          updated: { id: 1, title: 'Laundry', kind: 'chore' },
        });
      });
    });
  });

  describe('update whose filter its own nested write stops matching', () => {
    it.fails('updates the record it found', async () => {
      await withDatabase(async (db) => {
        await db.orm.Person.createAndCount([{ id: 41, managerId: null }]);
        const updated = await db.orm.Person.whereUnique({ id: 41 })
          .where((person) => person.reports.every((report) => report.id.lt(100)))
          .select('id', 'managerId')
          .update({
            manager: (manager) =>
              manager.create({ id: 200, manager: (above) => above.connect({ id: 41 }) }),
          });
        expect({
          updated,
          people: await db.orm.Person.select('id', 'managerId')
            .orderBy((person) => person.id.asc())
            .all(),
        }).toEqual({
          updated: { id: 41, managerId: 200 },
          people: [
            { id: 41, managerId: 200 },
            { id: 200, managerId: 41 },
          ],
        });
      });
    });
  });

  describe('a row another row of the same call changes', () => {
    it.fails('is returned by deleteAll the same with and without RETURNING', async () => {
      const deleted: unknown[] = [];
      for (const people of [
        (db: Client) => db.orm.Person,
        (db: Client) => withoutReturning(db).Person,
      ]) {
        await withDatabase(async (db) => {
          await db.orm.Person.createAndCount([
            { id: 1, managerId: null },
            { id: 2, managerId: 1 },
          ]);
          const rows = await people(db)
            .where((person) => person.id.in([1, 2]))
            .select('id', 'managerId')
            .deleteAll();
          deleted.push([...rows].sort((left, right) => left.id - right.id));
        });
      }
      expect(deleted[0]).toEqual(deleted[1]);
    });

    it.fails('is returned by update as the table holds it', async () => {
      await withDatabase(async (db) => {
        await db.orm.Person.createAndCount([{ id: 4, managerId: null }]);
        const updated = await db.orm.Person.whereUnique({ id: 4 })
          .select('id', 'managerId')
          .update({ id: 21, managerId: 4 });
        expect(updated).toEqual(
          await db.orm.Person.whereUnique({ id: 21 }).select('id', 'managerId').first(),
        );
      });
    });
  });
});
