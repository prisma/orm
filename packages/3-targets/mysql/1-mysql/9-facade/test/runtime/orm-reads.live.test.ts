import mysqlAdapter from '@internal/adapter-mysql/control';
import mysqlDriver from '@internal/driver-mysql/control';
import sql from '@internal/family-sql/control';
import { createControlStack } from '@internal/framework-components/control';
import mysqlTarget from '@internal/target-mysql/control';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineContract } from '../../src/exports/contract-builder';
import mysql from '../../src/runtime/mysql';
import { contractFromJson } from '../../src/static/contract-from-json';
import type { Contract } from '../fixtures/generated/contract.d';
import contractJson from '../fixtures/generated/contract.json' with { type: 'json' };
import { exampleDatabase, withSeededDatabase } from './live-database';

const contract = contractFromJson<Contract>(contractJson);

const countersContract = defineContract({}, ({ field, model, type }) => ({
  models: {
    Counter: model('Counter', {
      fields: { id: field.column(type.Int()).id(), big: field.column(type.BigInt()) },
    }),
  },
}));

const countersDatabase = [
  'CREATE TABLE `Counter` (`id` int NOT NULL, `big` bigint NOT NULL, PRIMARY KEY (`id`))',
  'INSERT INTO `Counter` VALUES (1, 9007199254740992), (2, 9007199254740993)',
] as const;

describe('MySQL reads through the ORM and the SQL builder', {
  timeout: timeouts.databaseOperation,
}, () => {
  it('filters, orders and limits', async (test) => {
    await withSeededDatabase(test, exampleDatabase, async (url) => {
      await using db = mysql({ contract, url, verifyMarker: false });
      const users = await db.orm.User.where({ role: 'ADMIN' })
        .select('id', 'email')
        .orderBy((u) => u.email.asc())
        .limit(2)
        .all();
      expect(users).toEqual([
        { id: 2, email: 'a@example.com' },
        { id: 1, email: 'b@example.com' },
      ]);
    });
  });

  it('skips rows with an offset, with and without a limit', async (test) => {
    await withSeededDatabase(test, exampleDatabase, async (url) => {
      await using db = mysql({ contract, url, verifyMarker: false });
      const ordered = db.orm.User.select('id', 'role').orderBy((u) => u.id.asc());
      expect({
        offset: await ordered.offset(2).all(),
        page: await ordered.offset(1).limit(2).all(),
      }).toEqual({
        offset: [
          { id: 3, role: 'USER' },
          { id: 4, role: 'ADMIN' },
        ],
        page: [
          { id: 2, role: 'ADMIN' },
          { id: 3, role: 'USER' },
        ],
      });
    });
  });

  it('finds the first row matching a filter', async (test) => {
    await withSeededDatabase(test, exampleDatabase, async (url) => {
      await using db = mysql({ contract, url, verifyMarker: false });
      expect({
        found: await db.orm.User.select('id', 'email').first({ id: 3 }),
        missing: await db.orm.User.select('id').first({ id: 99 }),
      }).toEqual({ found: { id: 3, email: 'c@example.com' }, missing: null });
    });
  });

  it('matches a bigint past 2^53 exactly on a column with no index', async (test) => {
    await withSeededDatabase(test, countersDatabase, async (url) => {
      await using db = mysql({ contract: countersContract, url, verifyMarker: false });
      expect(
        await db.orm.Counter.where({ big: 9007199254740993n })
          .select('id', 'big')
          .orderBy((c) => c.id.asc())
          .all(),
      ).toEqual([{ id: 2, big: 9007199254740993n }]);
    });
  });

  it('compares a bigint past 2^53 as an integer when the column side is an expression', async (test) => {
    await withSeededDatabase(test, countersDatabase, async (url) => {
      await using db = mysql({ contract: countersContract, url, verifyMarker: false });
      const rows = await db.query(
        db.sql.Counter.select('id')
          .where((f, fns) =>
            fns.eq(fns.raw`${f.big} + 0`.returns('mysql/bigint@1'), 9007199254740993n),
          )
          .build(),
      );
      expect(rows).toEqual([{ id: 2 }]);
    });
  });

  it('aggregates a collection, and answers an empty one with a zero count and nulls', async (test) => {
    await withSeededDatabase(test, exampleDatabase, async (url) => {
      await using db = mysql({ contract, url, verifyMarker: false });
      const stats = (minId: number) =>
        db.orm.Post.where((p) => p.id.gte(minId)).aggregate((a) => ({
          count: a.count(),
          total: a.sum('authorId'),
          mean: a.avg('authorId'),
          first: a.min('title'),
          last: a.max('title'),
        }));
      expect({ some: await stats(2), none: await stats(99) }).toEqual({
        some: { count: 3, total: 4, mean: 4 / 3, first: 'Beta', last: 'Gamma' },
        none: { count: 0, total: null, mean: null, first: null, last: null },
      });
    });
  });

  it('takes the least and greatest enum member by its text, where ORDER BY and PostgreSQL follow the declared order', async (test) => {
    await withSeededDatabase(test, exampleDatabase, async (url) => {
      await using db = mysql({ contract, url, verifyMarker: false });
      const extremes = await db.orm.User.aggregate((a) => ({
        least: a.min('role'),
        greatest: a.max('role'),
      }));
      const first = await db.orm.User.select('role')
        .orderBy((u) => u.role.asc())
        .first();
      expect({ extremes, first }).toEqual({
        extremes: { least: 'ADMIN', greatest: 'USER' },
        first: { role: 'USER' },
      });
    });
  });

  it('groups a collection and counts each group', async (test) => {
    await withSeededDatabase(test, exampleDatabase, async (url) => {
      await using db = mysql({ contract, url, verifyMarker: false });
      const groups = await db.orm.Post.groupBy('authorId').aggregate((a) => ({
        posts: a.count(),
        newest: a.max('id'),
      }));
      expect([...groups].sort((a, b) => a.authorId - b.authorId)).toEqual([
        { authorId: 1, posts: 3, newest: 3 },
        { authorId: 2, posts: 1, newest: 4 },
      ]);
    });
  });

  it('runs a SQL builder select', async (test) => {
    await withSeededDatabase(test, exampleDatabase, async (url) => {
      await using db = mysql({ contract, url, verifyMarker: false });
      const rows = await db.query(
        db.sql.User.select('id', 'email')
          .where((f, fns) => fns.eq(f.role, 'ADMIN'))
          .orderBy('id')
          .build(),
      );
      expect(rows).toEqual([
        { id: 1, email: 'b@example.com' },
        { id: 2, email: 'a@example.com' },
        { id: 4, email: 'd@example.com' },
      ]);
    });
  });

  it('binds a join condition param and a WHERE param to their own placeholders', async (test) => {
    await withSeededDatabase(test, exampleDatabase, async (url) => {
      await using db = mysql({ contract, url, verifyMarker: false });
      const rows = await db.query(
        db.sql.User.innerJoin(db.sql.Post, (f, fns) =>
          fns.and(fns.eq(f.User.id, f.Post.authorId), fns.eq(f.User.role, 'ADMIN')),
        )
          .select('email', 'title')
          .where((f, fns) => fns.eq(f.Post.title, 'Beta'))
          .build(),
      );
      expect(rows).toEqual([{ email: 'b@example.com', title: 'Beta' }]);
    });
  });

  it('binds a derived join source param and a WHERE param to their own placeholders', async (test) => {
    await withSeededDatabase(test, exampleDatabase, async (url) => {
      await using db = mysql({ contract, url, verifyMarker: false });
      const titled = db.sql.Post.select('authorId', 'title')
        .where((f, fns) => fns.eq(f.title, 'Delta'))
        .as('titled');
      const rows = await db.query(
        db.sql.User.innerJoin(titled, (f, fns) => fns.eq(f.User.id, f.titled.authorId))
          .select('email', 'title')
          .where((f, fns) => fns.eq(f.User.role, 'ADMIN'))
          .build(),
      );
      expect(rows).toEqual([{ email: 'a@example.com', title: 'Delta' }]);
    });
  });

  it('binds the WHERE param of a distinct query and of its include to their own placeholders', async (test) => {
    await withSeededDatabase(test, exampleDatabase, async (url) => {
      await using db = mysql({ contract, url, verifyMarker: false });
      const rows = await db.orm.User.where({ email: 'b@example.com' })
        .distinct('role')
        .select('role')
        .include('posts', (posts) => posts.where({ title: 'Beta' }).select('title'))
        .all();
      expect(rows).toEqual([{ role: 'ADMIN', posts: [{ title: 'Beta' }] }]);
    });
  });

  it('checks the marker the control tables hold, and warns when it is missing or differs', async (test) => {
    await withSeededDatabase(test, exampleDatabase, async (url, driver) => {
      const warnings = async () => {
        const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
        await using db = mysql({ contract, url, log });
        await db.orm.User.select('id').first({ id: 1 });
        return log.warn.mock.calls.map(([event]) => event.code);
      };
      const missing = await warnings();

      const adapter = mysqlAdapter.create(
        createControlStack({
          family: sql,
          target: mysqlTarget,
          adapter: mysqlAdapter,
          driver: mysqlDriver,
        }),
      );
      for (const node of adapter.bootstrapControlTableQueries()) {
        const { sql, params } = await adapter.lowerToExecuteRequest(node);
        await driver.query(sql, params);
      }
      await adapter.initMarker(driver, 'app', {
        storageHash: 'sha256:other',
        profileHash: contract.profileHash,
      });
      const differs = await warnings();
      await adapter.initMarker(driver, 'app', {
        storageHash: contract.storage.storageHash,
        profileHash: contract.profileHash,
      });
      const matches = await warnings();

      expect({ missing, differs, matches }).toEqual({
        missing: ['CONTRACT.MARKER_MISSING'],
        differs: ['CONTRACT.MARKER_MISMATCH'],
        matches: [],
      });
    });
  });
});
